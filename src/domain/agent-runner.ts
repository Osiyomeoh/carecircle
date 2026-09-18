import type { CareStore } from '../store/store.js';
import type { Notifier } from '../notify/notifier.js';
import { deliberate, AGENT_ID, type AgentAction, type Deliberation } from './agent.js';

/**
 * Carrying out what the policy decided.
 *
 * `agent.ts` decides and touches nothing; this performs the effects and touches
 * everything. Keeping them apart is what lets the hard thinking be tested against a
 * scripted week while this stays a thin, boring translation of a decision into store
 * writes and notifications.
 *
 * Every act the agent takes becomes an event in the same append-only log as every
 * human act, attributed to `system:carecircle`. That attribution is not cosmetic:
 * `attribution.ts` will render an agent-made request as "CareCircle asked Renee",
 * never as a person having asked, so "why did I get this?" is always answerable and
 * the machine is held to the same standard of saying who-said-so as everyone else.
 */

export interface AgentRun {
  householdId: string;
  at: string;
  deliberation: Deliberation;
  /** What actually happened, after effects - delivery can fail where a decision cannot. */
  performed: Array<{ action: AgentAction; delivered: boolean }>;
}

export interface RunnerDeps {
  store: CareStore;
  notifier: Notifier;
  now?: () => Date;
}

/**
 * Run the agent once over one household.
 *
 * Idempotent in the way that matters: the policy will not re-ask a person it has
 * already asked within the fatigue window, so running this every fifteen minutes
 * does not produce a request every fifteen minutes. Safe to call on a timer, on a
 * webhook, or by hand in a demo.
 */
export async function runAgentOnce(
  householdId: string, deps: RunnerDeps,
): Promise<AgentRun> {
  const now = deps.now?.() ?? new Date();
  const state = deps.store.getCareState(householdId);
  const deliberation = deliberate(state, { now, timezone: state.household.timezone });

  const performed: AgentRun['performed'] = [];
  for (const action of deliberation.actions) {
    if (action.kind === 'STAND_DOWN' || !action.memberId) continue;

    const member = state.members.find((m) => m.id === action.memberId);
    const obligation = state.obligations.find((o) => o.id === action.obligationId);
    if (!member || !obligation) continue;
    const name = member.spokenAs ?? member.name;

    // ASK moves the obligation to REQUESTED. ESCALATE flags the primary caregiver
    // but leaves status alone - escalation is a heads-up, not another ask in the
    // queue, and turning it into REQUESTED would make the board claim the boss is
    // being asked to do the driving.
    if (action.kind === 'ASK') {
      await deps.store.transition(
        action.obligationId, householdId, 'REQUESTED', AGENT_ID,
        { ownerId: null, request: { askedOfId: member.id, askedById: AGENT_ID, askedAt: now.toISOString() } },
        `CareCircle asked ${name}`,
      );
    }

    const delivery = await deps.notifier.deliver({
      to: member.id, toName: name, from: 'CareCircle',
      message: action.kind === 'ASK'
        ? `CareCircle noticed nobody has "${obligation.what}" yet. Can you take it on?`
        : `CareCircle couldn't find anyone for "${obligation.what}". It may need you to step in.`,
    });

    await deps.store.appendEvent({
      householdId,
      kind: 'owner_requested',
      reportedBy: AGENT_ID,
      occurredAt: now.toISOString(),
      detail: obligation.what,
      data: {
        obligationId: action.obligationId,
        askedOfId: member.id,
        escalation: action.kind === 'ESCALATE',
        delivered: delivery.delivered,
        // The arithmetic travels with the act, so an agent decision is auditable
        // from the log alone, exactly like a gap score.
        because: action.because,
        value: action.value,
      },
    });

    performed.push({ action, delivered: delivery.delivered });
  }

  return { householdId, at: now.toISOString(), deliberation, performed };
}

/** Run the agent over every household the store knows. */
export async function runAgentAll(deps: RunnerDeps): Promise<AgentRun[]> {
  const householdIds = [...new Set(deps.store.allMembers().map((m) => m.householdId))];
  const runs: AgentRun[] = [];
  for (const id of householdIds) runs.push(await runAgentOnce(id, deps));
  return runs;
}
