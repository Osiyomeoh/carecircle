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

/**
 * Severity is not a bag of hand-tuned points. It is an estimate of *expected harm*:
 *
 *     risk = Cost(harm) x P(the work is dropped) x Confidence(the gap is real)
 *
 * Each term is a real quantity in [0,1], so the final risk is a probability-weighted
 * cost in [0,1] and the HIGH/MEDIUM/LOW thresholds are risk tertiles, not magic
 * numbers. `score` is that risk x 100, kept for backward-compatible ranking.
 *
 * The three terms map one-to-one to the project's three beliefs:
 *  - Cost      -> "medical harm dominates logistical dominates social"
 *  - P(drop)   -> "work due sooner, or already overdue, is likelier to fall through"
 *  - Confidence-> "Known != Assumed": an inferred gap is discounted, never inflated.
 */

/** Cost(harm): normalized magnitude of harm if the work is dropped. Ratio 1 : 0.5 : 0.2. */
const HARM_COST: Record<ConsequenceClass, number> = {
  medical: 1.0,
  logistical: 0.5,
  social: 0.2,
};

/**
 * Time constants (hours) for the exponential hazards below. A time constant tau is
 * the horizon over which a failure probability relaxes by a factor of e; smaller
 * tau = urgency concentrates closer to the deadline.
 */
const TAU_DEADLINE = 48; // how fast drop-risk rises as a due time approaches
const TAU_STALE = 72;    // how fast unowned work accrues risk purely by aging
const TAU_DOSE = 240;    // how fast an unlogged dose looks truly missed (minutes)
const TAU_REPLY = 12;    // how fast an unanswered request stops counting for anything

/**
 * Confidence(the gap is real), a Bayesian posterior in (0,1]. This is the trust
 * model expressed as arithmetic: a CONFIRMED need is fact; an INFERRED one is a
 * named-rule guess we deliberately down-weight; a silence (NOT_LOGGED) sits between.
 * We multiply by confidence so an uncertain gap ranks *below* the same certain gap,
 * never above it - the engine can never let an assumption outrank a known fact.
 */
function confidenceOf(kind: 'CONFIRMED' | 'INFERRED' | 'NOT_LOGGED'): number {
  switch (kind) {
    case 'CONFIRMED': return 1.0;
    case 'NOT_LOGGED': return 0.75;
    case 'INFERRED': return 0.6;
  }
}

/** Probability at least one of two independent failure modes fires. */
function probOr(a: number, b: number): number {
  return 1 - (1 - a) * (1 - b);
}

/** Map a risk in [0,1] to the exposed 0-100 score. */
function toScore(risk: number): number {
  return Math.round(Math.max(0, Math.min(1, risk)) * 100);
}

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
 * P(dropped) from imminence, as a survival hazard rather than a staircase.
 *
 * Model the time a due task survives unattended as exponential: the probability it
 * has slipped by `now` is exp(-hoursUntilDue / TAU_DEADLINE) for future work, rising
 * smoothly to 1 as the deadline nears, and clamped at 1 once overdue. This is
 * monotone and continuous, so ranking never jumps at an arbitrary bucket edge.
 * Undated work has no deadline pressure but is not zero-risk: it sits at a fixed mid
 * hazard, because an unowned task with no due date can still be quietly forgotten.
 */
function imminenceHazard(dueAt: string | undefined, now: Date): number {
  if (!dueAt) return 0.35;
  const hoursUntil = (new Date(dueAt).getTime() - now.getTime()) / HOUR;
  if (hoursUntil <= 0) return 1; // overdue: it has already slipped
  return Math.exp(-hoursUntil / TAU_DEADLINE);
}

/**
 * P(dropped) contribution from age: unowned work accrues risk the longer it sits
 * with no one on it. 1 - exp(-age / TAU_STALE): 0 when fresh, approaching 1 as it
 * ages past several time constants.
 */
function stalenessHazard(createdAt: string, now: Date): number {
  const hours = (now.getTime() - new Date(createdAt).getTime()) / HOUR;
  if (hours <= 0) return 0;
  return 1 - Math.exp(-hours / TAU_STALE);
}

/** HIGH/MEDIUM/LOW as risk tertiles of the 0-100 score, not tuned cutoffs. */
function severityFor(score: number): Severity {
  if (score >= 66) return 'HIGH';
  if (score >= 33) return 'MEDIUM';
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
  // P(dropped) = deadline hazard OR aging hazard (either failure mode suffices).
  const cost = HARM_COST[o.consequence];
  const pDrop = probOr(imminenceHazard(o.dueAt, now), stalenessHazard(o.createdAt, now));
  const confidence = confidenceOf(o.provenance.kind);
  const score = toScore(cost * pDrop * confidence);
  const due = spokenDue(o.dueAt, timezone, now);
  return {
    id: `gap_unclaimed_${o.id}`,
    kind: 'UNCLAIMED',
    severity: severityFor(score),
    spoken: `${o.what}${due} - nobody has taken this yet.`,
    because: o.provenance.kind === 'INFERRED'
      ? `Confirmed as needed, originally inferred from ${o.provenance.from}. No owner assigned.`
      : 'This was recorded as needed and no one has claimed it.',
    obligationId: o.id,
    ...(o.dueAt ? { dueAt: o.dueAt } : {}),
    score,
    factors: { cost, pDrop, confidence },
  };
}

/**
 * Asked, but nobody has answered.
 *
 * A pending request earns a *discount* on drop-risk, not an exemption: somebody
 * being asked genuinely does make the work likelier to happen, but only while the
 * ask is fresh. The relief decays on TAU_REPLY, so an unanswered request climbs
 * back to the full risk of unowned work within a day. That is the arithmetic of
 * "I asked David" quietly becoming "nobody is doing this".
 */
function awaitingReplyGap(
  o: Obligation, askedOf: string, timezone: string, now: Date,
): CareGap {
  const cost = HARM_COST[o.consequence];
  const base = probOr(imminenceHazard(o.dueAt, now), stalenessHazard(o.createdAt, now));
  const hoursWaiting = o.request
    ? (now.getTime() - new Date(o.request.askedAt).getTime()) / HOUR
    : 0;
  const relief = 0.55 * Math.exp(-Math.max(0, hoursWaiting) / TAU_REPLY);
  const pDrop = base * (1 - relief);
  const confidence = confidenceOf(o.provenance.kind);
  const score = toScore(cost * pDrop * confidence);
  const due = spokenDue(o.dueAt, timezone, now);
  return {
    id: `gap_awaiting_${o.id}`,
    kind: 'UNCLAIMED',
    severity: severityFor(score),
    // "asked" and "agreed" are different words on purpose.
    spoken: `${o.what}${due} - ${askedOf} was asked and hasn't answered yet.`,
    because: `${askedOf} has been asked but has not accepted, so this still has no owner.`,
    obligationId: o.id,
    ...(o.dueAt ? { dueAt: o.dueAt } : {}),
    score,
    factors: { cost, pDrop, confidence },
  };
}

function followUpGap(o: Obligation, timezone: string, now: Date): CareGap {
  // Assigned but past due: it has slipped (hazard -> 1). Still weighted by how bad
  // dropping it is, and by how sure we are the underlying need was real.
  const cost = HARM_COST[o.consequence];
  const pDrop = imminenceHazard(o.dueAt, now);
  const confidence = confidenceOf(o.provenance.kind);
  const score = toScore(cost * pDrop * confidence);
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
    factors: { cost, pDrop, confidence },
  };
}

/**
 * Medication doses that were expected earlier today and have no matching record.
 *
 * The hard rule of this project lives here: a missing record is reported as
 * *missing*, never as "they did not take it". The phrasing below is a constraint,
 * not a style choice - see docs/DESIGN.md section 2.
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
      // The longer a due dose goes unlogged, the likelier it truly slipped:
      // P = 1 - exp(-minutesLate / TAU_DOSE). Weighted by medical cost, and by the
      // NOT_LOGGED confidence - a silence is real evidence, but weaker than a
      // human confirmation, which is exactly why we never phrase it as "missed".
      const pMissed = 1 - Math.exp(-minutesLate / TAU_DOSE);
      const confidence = confidenceOf('NOT_LOGGED');
      const score = toScore(HARM_COST.medical * pMissed * confidence);
      gaps.push({
        id: `gap_unconfirmed_${med.id}_${nowLocal.date}_${time}`,
        kind: 'UNCONFIRMED',
        severity: severityFor(score),
        // Deliberate phrasing: no record != did not happen.
        spoken: `There's no record of ${name}'s ${med.name} from ${time}.`,
        because: `A dose was expected at ${time} and nothing has been logged. `
          + `This means no one has confirmed it - not that it was missed.`,
        score,
        factors: { cost: HARM_COST.medical, pDrop: pMissed, confidence },
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
    } else if (o.status === 'REQUESTED' && o.ownerId === null) {
      // Still a gap. Someone was asked; nobody has agreed.
      const askedOf = state.members.find((m) => m.id === o.request?.askedOfId);
      gaps.push(awaitingReplyGap(
        o, askedOf?.spokenAs ?? askedOf?.name ?? 'Someone', timezone, now,
      ));
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
