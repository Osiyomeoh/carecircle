import type { Member, Obligation, Role } from './types.js';

/**
 * Who may do what.
 *
 * The household, not the individual, is the unit of state — so every tool call
 * arrives with an identified member and is checked against their role. Identity
 * comes from the MCP session credential, never from the conversation, because a
 * model can be talked into believing anything about who is speaking.
 */

export type Capability =
  | 'log_own_event'      // record something about yourself
  | 'log_others_event'   // record something on someone else's behalf
  | 'read_full_state'    // see the whole care picture
  | 'read_shift'         // see only what this shift needs
  | 'create_obligation'
  | 'claim_obligation'   // take work yourself
  | 'assign_obligation'  // give work to someone else
  | 'confirm_proposal'   // turn an inference into real work
  | 'resolve_obligation'
  | 'escalate'           // pull a human in urgently
  | 'manage_circle'      // add or remove members, edit medication schedules
  | 'make_purchase';     // offer and confirm a purchase that commits money

const CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  // The person being cared for: full authority over their own life, and they can
  // see their own day. They are a participant, not a subject.
  care_recipient: new Set([
    'log_own_event', 'read_shift', 'create_obligation',
  ]),
  primary_caregiver: new Set([
    'log_own_event', 'log_others_event', 'read_full_state', 'read_shift',
    'create_obligation', 'claim_obligation', 'assign_obligation',
    'confirm_proposal', 'resolve_obligation', 'escalate', 'manage_circle',
    'make_purchase',
  ]),
  caregiver: new Set([
    'log_own_event', 'log_others_event', 'read_full_state', 'read_shift',
    'create_obligation', 'claim_obligation', 'confirm_proposal',
    'resolve_obligation', 'make_purchase',
  ]),
  // A paid helper: scoped to the work in front of them.
  helper: new Set([
    'log_others_event', 'read_shift', 'claim_obligation', 'resolve_obligation',
  ]),
};

export function can(member: Member, capability: Capability): boolean {
  return CAPABILITIES[member.role].has(capability);
}

/**
 * Denial reasons are written for a model to speak, not for a developer to debug.
 * They say what the person *can* do, so the conversation keeps moving instead of
 * dead-ending in an error.
 */
const DENIAL: Partial<Record<Capability, string>> = {
  assign_obligation:
    'Only the primary caregiver can assign work to someone else. You can take it on yourself instead.',
  escalate:
    'Only the primary caregiver can raise an urgent alert. You could add a note so they see it.',
  read_full_state:
    "You have access to what's needed for your shift rather than the full care record.",
  confirm_proposal:
    'Only a family caregiver can confirm whether this is really needed.',
  log_others_event:
    'You can log things about yourself here.',
  make_purchase:
    'Placing an order is something a family caregiver does. I can tell one of them it is needed.',
};

export class NotPermittedError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability, message: string) {
    super(message);
    this.name = 'NotPermittedError';
    this.capability = capability;
  }
}

export function require(member: Member, capability: Capability): void {
  if (can(member, capability)) return;
  throw new NotPermittedError(
    capability,
    DENIAL[capability] ?? `You don't have permission to do that.`,
  );
}

/**
 * Whether a member may act on a specific obligation.
 *
 * Helpers are scoped to work they own, so an aide cannot resolve the family's
 * private business simply because it appeared in a list.
 */
export function canActOn(member: Member, obligation: Obligation): boolean {
  if (member.role === 'helper') return obligation.ownerId === member.id;
  return true;
}
