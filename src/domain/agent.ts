import type { CareState, Member, Obligation } from './types.js';
import { detectCareGaps } from './gaps.js';
import { candidatesFor, type Candidate } from './delegation.js';

/**
 * The agent: what CareCircle does when nobody is talking to it.
 *
 * Everything else in this system waits for a person to speak. That is the failure
 * the product claims to solve, happening inside the product: an unowned cardiology
 * ride can sit all day and nothing happens until somebody thinks to ask. The
 * orchestrator was already here - `candidatesFor` ranks who to ask, `detectCareGaps`
 * knows what is slipping - and neither of them had a clock.
 *
 * ## Why this is a policy and not a cron job
 *
 * A rule like "if a gap is older than six hours, ask someone" is a scheduler wearing
 * an agent's clothes. Its bounds are arbitrary, its behaviour at the edges is
 * whatever the thresholds happen to do, and it cannot explain itself beyond quoting
 * its own constant.
 *
 * So the agent decides the way the ranking engine already scores: by arithmetic that
 * a person can recompute. For every candidate action it weighs
 *
 *     value = harmAvoided - interruptionCost
 *
 * and acts on the best action only when that value is positive. Both terms come from
 * the same factors the Care Gap score already publishes, so **every decision - and
 * every decision NOT to act - is explainable in the same units as everything else.**
 *
 * The good consequences fall out of the policy rather than being bolted on:
 *
 *  - It does not message anyone at 3am, because the interruption cost at 3am exceeds
 *    the harm avoided by nearly any ask. Not an `if (isNight) return`.
 *  - It stops badgering, because asking the same person again costs more each time.
 *  - It gives up, because once the circle is exhausted no action has positive value.
 *  - It prioritises correctly, because harmAvoided is the existing gap score.
 *
 * ## What the agent may never do
 *
 * It asks. It never assigns. The same rule that binds every human in the system
 * binds the machine: `REQUESTED` carries no owner, and the work stays unowned until
 * a person says yes. An autonomous system that could put work in someone's name
 * while they slept would be a different and much worse product.
 *
 * Its actions are recorded as events attributed to the system, so "why did I get
 * this?" is always answerable from the log.
 */

/** Who the agent speaks as. Not a member: it has no role and holds no work. */
export const AGENT_ID = 'system:carecircle';

export interface AgentAction {
  kind: 'ASK' | 'ESCALATE' | 'STAND_DOWN';
  obligationId: string;
  /** Who to ask, or who to escalate to. Absent on STAND_DOWN. */
  memberId?: string;
  /** Plain language, in the same register as `Candidate.because`. */
  because: string;
  /** The arithmetic, exposed so the decision can be audited like a gap score. */
  value: {
    harmAvoided: number;
    interruptionCost: number;
    net: number;
  };
}

/**
 * A considered and rejected action, kept so the agent can say why it stayed quiet.
 *
 * An autonomous system that only reports what it did is not auditable. Most of the
 * time this one decides to do nothing, and that is the decision most worth being
 * able to inspect.
 */
export interface Restraint {
  obligationId: string;
  because: string;
  value: AgentAction['value'];
}

export interface Deliberation {
  actions: AgentAction[];
  restraint: Restraint[];
}

export interface PolicyOptions {
  now: Date;
  /** Household timezone, for working out whether it is the middle of the night. */
  timezone: string;
  /**
   * Most actions the agent may take in one pass. Not a safety mechanism - the policy
   * is - but a hard stop against a bug becoming a flood.
   */
  maxActions?: number;
}

/**
 * The modelled effect of an outstanding ask, from gaps.ts.
 *
 * Asking does not close a gap; it reduces the chance the work is dropped, and that
 * reduction decays while nobody answers. Reusing the constant matters: the agent
 * must value an ask exactly as much as the ranking engine does, or the two halves of
 * the system disagree about the same event.
 */
const ASK_RELIEF = 0.55;

/**
 * What it costs to interrupt somebody, in the same units as harm avoided.
 *
 * Calibrated so a routine logistical nudge does not clear the bar on its own, while
 * an imminent medical gap does. These are judgements, and they are written here in
 * one place rather than scattered through conditionals.
 */
const BASE_INTERRUPTION = 0.12;

/**
 * Each previous ask of the same person makes the next one cost more - and the
 * growth is **superlinear**, because being asked a fifth time is far worse than five
 * times being asked once.
 *
 * This started linear and a test caught it: with linear growth a high-risk medical
 * gap stayed worth asking about after fifteen consecutive asks, which is not an
 * agent exercising judgement, it is an agent nagging. Compounding gives the property
 * the product actually needs - the agent runs out of patience with itself before a
 * person runs out of patience with it - and it does so without a hard cap, so an
 * emergency can still get through.
 */
const FATIGUE_BASE = 1.9;

/** How long an ask stays "recent" for fatigue, in hours. */
const FATIGUE_WINDOW_HOURS = 24;

/**
 * Night multiplier.
 *
 * Large enough that nothing routine survives it, and finite rather than infinite:
 * the agent is not forbidden from waking a household, it simply needs a reason worth
 * far more than the sleep. A medical obligation minutes from its deadline can still
 * clear this. That is the correct behaviour and a hard rule could not express it.
 */
const NIGHT_MULTIPLIER = 9;

const QUIET_START_HOUR = 21; // 9pm
const QUIET_END_HOUR = 8;    // 8am

/** The local hour in the household's own timezone, not the server's. */
function localHour(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', hour12: false,
  }).formatToParts(at);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
}

function isQuietHours(at: Date, timezone: string): boolean {
  const hour = localHour(at, timezone);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * How many times the agent has asked this person anything, recently.
 *
 * Counts the agent's own asks only. A person asked directly by their sibling has not
 * been bothered by us, and charging the machine for a human's request would make the
 * agent go quiet precisely when a family is already trying to sort something out.
 */
export function recentAsksOf(memberId: string, state: CareState, now: Date): number {
  const cutoff = now.getTime() - FATIGUE_WINDOW_HOURS * 3_600_000;
  return state.events.filter((e) => (
    e.kind === 'owner_requested'
    && e.reportedBy === AGENT_ID
    && e.data['askedOfId'] === memberId
    && new Date(e.occurredAt).getTime() >= cutoff
  )).length;
}

/** The cost of interrupting this person, now. */
export function interruptionCost(
  memberId: string, state: CareState, opts: PolicyOptions,
): number {
  const fatigue = FATIGUE_BASE ** recentAsksOf(memberId, state, opts.now);
  const night = isQuietHours(opts.now, opts.timezone) ? NIGHT_MULTIPLIER : 1;
  return BASE_INTERRUPTION * fatigue * night;
}

/**
 * Risk per obligation, in [0,1], scored once per deliberation.
 *
 * This called `detectCareGaps` inside the per-obligation loop, which re-scored the
 * entire board for every obligation on it - quadratic, and it showed: a property
 * test at sixty obligations took thirteen seconds. The board is one calculation.
 */
function riskIndex(state: CareState, now: Date): Map<string, number> {
  const index = new Map<string, number>();
  for (const gap of detectCareGaps(state, { now })) {
    if (gap.obligationId) index.set(gap.obligationId, gap.score / 100);
  }
  return index;
}

/**
 * Harm avoided by asking this candidate.
 *
 * The relief an ask provides is discounted by how likely this person is to be able
 * to say yes. Load is the only honest proxy we hold - somebody already carrying four
 * things is less likely to take a fifth - and it is the same number `candidatesFor`
 * ranks on, so the agent and the ranking cannot disagree.
 */
export function harmAvoided(
  obligation: Obligation, candidate: Candidate, state: CareState, now: Date,
): number {
  return valueOfAsk(riskIndex(state, now).get(obligation.id) ?? 0, candidate.load);
}

/** The same arithmetic, on a risk already in hand. */
function valueOfAsk(risk: number, load: number): number {
  return risk * ASK_RELIEF * (1 / (1 + load));
}

/** Obligations the agent may pursue: real work, nobody on it, not already asked. */
function pursuable(state: CareState): Obligation[] {
  return state.obligations.filter((o) => o.status === 'OPEN' && !o.ownerId);
}

/** An ask that has gone unanswered long enough to move on from. */
function stalled(obligation: Obligation, now: Date): boolean {
  if (obligation.status !== 'REQUESTED' || !obligation.request) return false;
  const waited = (now.getTime() - new Date(obligation.request.askedAt).getTime()) / 3_600_000;
  // TAU_REPLY in gaps.ts is 12h: by then an outstanding ask has decayed to ~37% of
  // its relief and is no longer doing much for anybody.
  return waited >= 12;
}

function primaryCaregiver(state: CareState): Member | undefined {
  return state.members.find((m) => m.role === 'primary_caregiver');
}

/**
 * Decide what, if anything, to do right now.
 *
 * Pure: the same state and the same instant always produce the same decision, which
 * is what lets the whole policy be tested against a scripted week rather than by
 * leaving a server running and hoping. Nothing here performs an action; the caller
 * owns every effect.
 */
export function deliberate(state: CareState, opts: PolicyOptions): Deliberation {
  const actions: AgentAction[] = [];
  const restraint: Restraint[] = [];
  const max = opts.maxActions ?? 3;
  const risk = riskIndex(state, opts.now);

  // Work that has been asked about, and the ask has gone stale. The family has not
  // said no - nobody has said anything - so we move down the circle rather than
  // repeating ourselves at the same person.
  for (const o of state.obligations.filter((x) => stalled(x, opts.now))) {
    const asked = o.request?.askedOfId;
    const next = candidatesFor(o, state)
      .find((c) => c.memberId !== asked);
    const boss = primaryCaregiver(state);

    if (next) {
      const gain = valueOfAsk(risk.get(o.id) ?? 0, next.load);
      const cost = interruptionCost(next.memberId, state, opts);
      const value = { harmAvoided: gain, interruptionCost: cost, net: gain - cost };
      const because = `Nobody answered about "${o.what}", so I asked ${next.name} instead.`;
      if (value.net > 0) actions.push({ kind: 'ASK', obligationId: o.id, memberId: next.memberId, because, value });
      else restraint.push({ obligationId: o.id, because: `Waiting rather than asking ${next.name}: ${reasonForQuiet(opts)}`, value });
      continue;
    }

    // Nobody left to ask. Tell the person who can actually decide, once, then stop.
    if (boss && boss.id !== asked) {
      const gain = (risk.get(o.id) ?? 0) * ASK_RELIEF;
      const cost = interruptionCost(boss.id, state, opts);
      const value = { harmAvoided: gain, interruptionCost: cost, net: gain - cost };
      const because = `Everyone I could ask about "${o.what}" has declined or is unavailable.`;
      if (value.net > 0) actions.push({ kind: 'ESCALATE', obligationId: o.id, memberId: boss.id, because, value });
      else restraint.push({ obligationId: o.id, because, value });
      continue;
    }

    restraint.push({
      obligationId: o.id,
      because: `I have run out of people to ask about "${o.what}". It stays on the board.`,
      value: { harmAvoided: 0, interruptionCost: 0, net: 0 },
    });
  }

  // Unowned work nobody has been asked about yet.
  for (const o of pursuable(state)) {
    const best = candidatesFor(o, state)[0];
    if (!best) {
      restraint.push({
        obligationId: o.id,
        because: `There is nobody I can ask about "${o.what}".`,
        value: { harmAvoided: 0, interruptionCost: 0, net: 0 },
      });
      continue;
    }
    const gain = valueOfAsk(risk.get(o.id) ?? 0, best.load);
    const cost = interruptionCost(best.memberId, state, opts);
    const value = { harmAvoided: gain, interruptionCost: cost, net: gain - cost };

    if (value.net > 0) {
      actions.push({
        kind: 'ASK', obligationId: o.id, memberId: best.memberId, value,
        because: `Nobody has taken "${o.what}". I asked ${best.name} because they're the one who ${best.because}.`,
      });
    } else {
      restraint.push({
        obligationId: o.id,
        because: `Not asking ${best.name} about "${o.what}" yet: ${reasonForQuiet(opts)}`,
        value,
      });
    }
  }

  // Highest net value first: when the agent can only do a few things, it should do
  // the ones that matter most, for the same reason the board ranks gaps.
  actions.sort((a, b) => b.value.net - a.value.net);
  return { actions: actions.slice(0, max), restraint };
}

/** Why the agent is staying quiet, in words rather than numbers. */
function reasonForQuiet(opts: PolicyOptions): string {
  return isQuietHours(opts.now, opts.timezone)
    ? 'it is the middle of the night and this is not urgent enough to wake anyone'
    : 'it is not yet worth interrupting somebody over';
}
