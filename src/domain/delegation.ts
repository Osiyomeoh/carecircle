import type { CareState, Member, Obligation } from './types.js';
import { can } from './auth.js';

/**
 * Choosing who to ask.
 *
 * The Care Gap engine finds work nobody owns. This decides who to *ask* about it -
 * the step between noticing a gap and closing it.
 *
 * Two rules govern everything here, and both are deliberate:
 *
 *  1. **Asking is not assigning.** Nothing in this file moves ownership. It returns
 *     candidates and the reason each was chosen; a human still has to say yes.
 *  2. **The choice must be explainable.** Every candidate carries `because` in plain
 *     language, because "the computer picked you" is not an acceptable answer when
 *     the subject is who looks after someone's mother.
 */

export interface Candidate {
  memberId: string;
  /** How to refer to them out loud. */
  name: string;
  /** Why this person, in words a model can speak unchanged. */
  because: string;
  /** How many pieces of work they already hold. Lower is why they ranked higher. */
  load: number;
}

/**
 * Family is a *tier*, not a tie-break.
 *
 * A paid helper is scoped to the work in front of them - the same reason `canActOn`
 * limits them to what they own. Ranking purely by who is least busy would hand the
 * aide the cardiology drive ahead of both children simply because she starts the
 * week empty, which is neither what the family means nor what they are paying for.
 * Helpers are asked only once the family has run out.
 */
function tierOf(role: Member['role']): number {
  return role === 'helper' ? 1 : 0;
}

/** Within a tier, and only at equal load, prefer the person closest to the care. */
const ROLE_ORDER: Record<Member['role'], number> = {
  primary_caregiver: 0,
  caregiver: 1,
  helper: 2,
  care_recipient: 3,
};

/**
 * Whether a member has said they cannot cover the moment this work is due.
 *
 * Unavailability is recorded by `add_note` as an event carrying the window. We only
 * exclude somebody when we have a *stated* conflict overlapping the due time - not
 * knowing someone's plans is not evidence that they are free, but it is also not
 * evidence that they are busy, so silence leaves them eligible.
 */
export function statedUnavailable(
  member: Member, state: CareState, dueAt: string | undefined,
): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return false;

  return state.events.some((e) => {
    const u = e.data['unavailable'] as
      { memberName?: string; from?: string; to?: string } | undefined;
    if (!u?.from || !u.to || !u.memberName) return false;
    const named = u.memberName.trim().toLowerCase();
    if (named !== member.name.toLowerCase() && named !== (member.spokenAs ?? '').toLowerCase()) {
      return false;
    }
    const from = new Date(u.from).getTime();
    const to = new Date(u.to).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    return due >= from && due <= to;
  });
}

/** How much work someone is already carrying. */
export function loadOf(memberId: string, state: CareState): number {
  return state.obligations.filter(
    (o) => o.ownerId === memberId && o.status === 'ASSIGNED',
  ).length;
}

/**
 * Who could reasonably take this on, best first.
 *
 * Excluded, and each for a reason we can defend out loud:
 *  - anyone who cannot take work on at all (the care recipient is a participant in
 *    their own care, but we do not hand them their own transport problem);
 *  - whoever is doing the asking, because if they wanted it they would claim it;
 *  - anyone who has already declined this specific piece of work - the agent must
 *    not badger, and a decline is information we keep;
 *  - anyone who has *said* they cannot cover the time it is due.
 *
 * Ordering is family before paid help, then existing load, then role, then name.
 * Load ahead of role within a tier is what stops the system quietly dumping
 * everything on whoever answers fastest - the failure mode families actually have.
 */
export function candidatesFor(
  obligation: Obligation,
  state: CareState,
  opts: { askerId?: string } = {},
): Candidate[] {
  const declined = new Set(obligation.declinedBy ?? []);

  const eligible = state.members
    .filter((m) => can(m, 'claim_obligation'))
    .filter((m) => m.id !== opts.askerId)
    .filter((m) => m.id !== obligation.ownerId)
    .filter((m) => !declined.has(m.id))
    .filter((m) => !statedUnavailable(m, state, obligation.dueAt));

  return eligible
    .map((m) => ({ member: m, load: loadOf(m.id, state) }))
    .sort((a, b) => (
      tierOf(a.member.role) - tierOf(b.member.role)
      || a.load - b.load
      || ROLE_ORDER[a.member.role] - ROLE_ORDER[b.member.role]
      || a.member.name.localeCompare(b.member.name)
    ))
    .map(({ member, load }) => ({
      memberId: member.id,
      name: member.spokenAs ?? member.name,
      load,
      because: reasonFor(load, declined.size),
    }));
}

function reasonFor(load: number, declinedCount: number): string {
  const after = declinedCount > 0 ? ' and is next after the people already asked' : '';
  if (load === 0) return `has nothing else on the care board right now${after}`;
  if (load === 1) return `has one other thing on${after}`;
  return `has ${load} other things on${after}`;
}
