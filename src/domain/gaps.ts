import type {
  CareGap, CareState, ConsequenceClass, Obligation, Severity,
} from './types.js';

/**
 * The Care Gap engine.
 *
 * Deterministic logic that computes what is falling through the cracks. This is
 * deliberately NOT model narration: the model receives ranked, reasoned, structured
 * gaps and only has to speak them. That keeps the reasoning auditable and the
 * server useful to any client, not just an LLM.
 */

const HOUR = 3_600_000;

/** How much each consequence class contributes to urgency. Medical dominates. */
const CONSEQUENCE_WEIGHT: Record<ConsequenceClass, number> = {
  medical: 50,
  logistical: 25,
  social: 10,
};

/** Local wall-clock parts for an instant, in the household's timezone. */
function localParts(at: Date, timezone: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  // en-CA renders midnight as "24" in some runtimes; normalise to 0.
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
  };
}

function parseHHMM(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Imminence score: work due soon, or already overdue, outranks distant work.
 * Undated work sits in the middle — it has no deadline but it is still unowned.
 */
function imminenceScore(dueAt: string | undefined, now: Date): number {
  if (!dueAt) return 15;
  const hoursUntil = (new Date(dueAt).getTime() - now.getTime()) / HOUR;
  if (hoursUntil < 0) return 45;      // overdue
  if (hoursUntil <= 24) return 40;    // today or tonight
  if (hoursUntil <= 72) return 30;    // within three days
  if (hoursUntil <= 168) return 20;   // this week
  return 5;
}

/** Work nobody has picked up gains urgency the longer it sits. */
function staleness(createdAt: string, now: Date): number {
  const hours = (now.getTime() - new Date(createdAt).getTime()) / HOUR;
  if (hours >= 72) return 15;
  if (hours >= 24) return 8;
  return 0;
}

function severityFor(score: number): Severity {
  if (score >= 85) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

/** Natural-language due phrasing, so the model can speak it unchanged. */
function spokenDue(dueAt: string | undefined, timezone: string, now: Date): string {
  if (!dueAt) return '';
  const due = new Date(dueAt);
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const time = timeFmt.format(due).replace(':00', '');
  const today = localParts(now, timezone).date;
  const dueDate = localParts(due, timezone).date;
  if (dueDate === today) return ` today at ${time}`;
  const daysOut = (new Date(dueDate).getTime() - new Date(today).getTime()) / (24 * HOUR);
  if (daysOut === 1) return ` tomorrow at ${time}`;
  if (daysOut > 1 && daysOut < 7) return ` ${dayFmt.format(due)} at ${time}`;
  return ` on ${new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, month: 'long', day: 'numeric',
  }).format(due)} at ${time}`;
}

function unclaimedGap(o: Obligation, timezone: string, now: Date): CareGap {
  const score = CONSEQUENCE_WEIGHT[o.consequence]
    + imminenceScore(o.dueAt, now)
    + staleness(o.createdAt, now);
  const due = spokenDue(o.dueAt, timezone, now);
  return {
    id: `gap_unclaimed_${o.id}`,
    kind: 'UNCLAIMED',
    severity: severityFor(score),
    spoken: `${o.what}${due} — nobody has taken this yet.`,
    because: o.provenance.kind === 'INFERRED'
      ? `Confirmed as needed, originally inferred from ${o.provenance.from}. No owner assigned.`
      : 'This was recorded as needed and no one has claimed it.',
    obligationId: o.id,
    ...(o.dueAt ? { dueAt: o.dueAt } : {}),
    score,
  };
}

function followUpGap(o: Obligation, timezone: string, now: Date): CareGap {
  const score = CONSEQUENCE_WEIGHT[o.consequence] + imminenceScore(o.dueAt, now);
  const due = spokenDue(o.dueAt, timezone, now);
  return {
    id: `gap_followup_${o.id}`,
    kind: 'NEEDS_FOLLOW_UP',
    severity: severityFor(score),
    spoken: `${o.what} was due${due} and hasn't been marked done.`,
    because: 'Assigned but past its due time with no resolution recorded.',
    obligationId: o.id,
    ...(o.dueAt ? { dueAt: o.dueAt } : {}),
    score,
  };
}

/**
 * Medication doses that were expected earlier today and have no matching record.
 *
 * The hard rule of this project lives here: a missing record is reported as
 * *missing*, never as "they did not take it". The phrasing below is a constraint,
 * not a style choice — see docs/DESIGN.md section 2.
 */
function unconfirmedMedicationGaps(state: CareState, now: Date): CareGap[] {
  const { timezone } = state.household;
  const nowLocal = localParts(now, timezone);
  const gaps: CareGap[] = [];

  for (const med of state.medications) {
    const who = state.members.find((m) => m.id === med.forMemberId);
    const name = who?.spokenAs ?? who?.name ?? 'they';

    for (const time of med.times) {
      const expectedMinutes = parseHHMM(time);
      if (expectedMinutes === null) continue;

      // Only look at doses whose time has already passed today, with a grace period.
      const GRACE_MINUTES = 60;
      if (nowLocal.minutes < expectedMinutes + GRACE_MINUTES) continue;

      const logged = state.events.some((e) => {
        if (e.kind !== 'medication_taken') return false;
        if (e.data['medicationId'] !== med.id) return false;
        const ev = localParts(new Date(e.occurredAt), timezone);
        if (ev.date !== nowLocal.date) return false;
        // Attribute a dose to the nearest expected time, within three hours.
        return Math.abs(ev.minutes - expectedMinutes) <= 180;
      });
      if (logged) continue;

      const minutesLate = nowLocal.minutes - expectedMinutes;
      const score = CONSEQUENCE_WEIGHT.medical + (minutesLate > 240 ? 35 : 20);
      gaps.push({
        id: `gap_unconfirmed_${med.id}_${nowLocal.date}_${time}`,
        kind: 'UNCONFIRMED',
        severity: severityFor(score),
        // Deliberate phrasing: no record != did not happen.
        spoken: `There's no record of ${name}'s ${med.name} from ${time}.`,
        because: `A dose was expected at ${time} and nothing has been logged. `
          + `This means no one has confirmed it — not that it was missed.`,
        score,
      });
    }
  }
  return gaps;
}

export interface GapOptions {
  /** Only include gaps due within this many days. Undated gaps always included. */
  withinDays?: number;
  now?: Date;
}

/**
 * Compute every Care Gap in the household, ranked most urgent first.
 *
 * Pure: same state and same `now` always produce the same gaps, which is what
 * makes the "what's going to fall through the cracks?" answer trustworthy.
 */
export function detectCareGaps(state: CareState, options: GapOptions = {}): CareGap[] {
  const now = options.now ?? new Date();
  const { timezone } = state.household;
  const gaps: CareGap[] = [];

  for (const o of state.obligations) {
    // PROPOSED obligations are not gaps: they are guesses awaiting a human.
    // Surfacing them as work would be exactly the inference-as-fact error
    // the trust model forbids.
    if (o.status === 'OPEN' && o.ownerId === null) {
      gaps.push(unclaimedGap(o, timezone, now));
    } else if (o.status === 'ASSIGNED' && o.dueAt && new Date(o.dueAt) < now) {
      gaps.push(followUpGap(o, timezone, now));
    }
  }

  gaps.push(...unconfirmedMedicationGaps(state, now));

  const filtered = options.withinDays === undefined
    ? gaps
    : gaps.filter((g) => {
        if (!g.dueAt) return true;
        const days = (new Date(g.dueAt).getTime() - now.getTime()) / (24 * HOUR);
        return days <= options.withinDays!;
      });

  return filtered.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Obligations the system inferred and is not yet willing to treat as real.
 * These are surfaced for confirmation, not presented as work to be done.
 */
export function pendingProposals(state: CareState): Obligation[] {
  return state.obligations.filter((o) => o.status === 'PROPOSED');
}
