/**
 * Accessibility as a first-class fact of the responsibility graph.
 *
 * The widening this module makes is small in code and load-bearing in meaning: an
 * obligation can be *about* a subject (a member or an entity), and that subject can carry
 * standing facts - "getting there needs an accessible vehicle", "this needs a hands-on
 * helper". Those facts change two things, deterministically:
 *
 *   1. Risk. A dropped ride for someone who needs accessible transport is not a simple
 *      reschedule - the fall-backs are fewer and slower - so P(dropped) is genuinely
 *      higher. The uplift is monotone and bounded, so it can only raise a gap's rank,
 *      never invent one.
 *
 *   2. How we explain it. This is the same refusal the rest of the system runs on, one
 *      level over: just as a silence must never become "she didn't do it", a disability
 *      must never become "she's a burden" or "she can't cope". The note this module
 *      speaks is always a fact about the *task* ("fewer fall-back rides"), never a verdict
 *      about the person. accessibility.test.ts asserts that refusal over generated inputs.
 *
 * Pure functions of recorded state, so the honesty is testable.
 */
import type { CareState, EntityAttributes, Obligation } from './types.js';

/** Probability at least one of two independent modes fires. Shared shape with gaps.ts. */
function probOr(a: number, b: number): number {
  return 1 - (1 - a) * (1 - b);
}

/**
 * The subject's standing attributes, resolved from the obligation's `aboutEntityId`.
 * Looks among people first (a person is a Member), then non-person entities. Returns
 * undefined when nothing is attached - the overwhelmingly common case, and the reason
 * every existing obligation's risk is unchanged.
 */
export function resolveSubjectAttributes(
  state: Pick<CareState, 'members' | 'entities'>,
  o: Obligation,
): EntityAttributes | undefined {
  if (!o.aboutEntityId) return undefined;
  // Tolerate a state assembled without these arrays (older callers, test fixtures): an
  // absent members/entities list simply means nothing resolves, never a crash.
  const member = (state.members ?? []).find((m) => m.id === o.aboutEntityId);
  if (member?.attributes) return member.attributes;
  const entity = (state.entities ?? []).find((e) => e.id === o.aboutEntityId);
  return entity?.attributes;
}

/**
 * How much these attributes raise P(dropped), in [0, 1). Zero when nothing applies, so a
 * subject with no accessibility needs leaves the gap engine's arithmetic untouched.
 *
 * The two hazards are combined with probOr, never summed, so the result stays a
 * probability and the ceiling stays below certainty - an attribute sharpens attention,
 * it does not manufacture an emergency.
 */
export function accessibilityUplift(attrs: EntityAttributes | undefined): number {
  if (!attrs) return 0;
  // A missing accessible ride has the fewest substitutes, so it carries the larger uplift.
  const transport = attrs.needsAccessibleTransport ? 0.3 : 0;
  // Needing a hands-on helper narrows who can pick the work up, which raises drop-risk too.
  const assistance = attrs.requiresAssistance ? 0.15 : 0;
  return probOr(transport, assistance);
}

/**
 * One plain clause explaining *why this ranks where it does*, safe to read aloud. It is
 * always a statement about the task's logistics, never about the person. Returns undefined
 * when there is nothing to say, so callers append nothing rather than an empty phrase.
 *
 * Deliberately spoken in the language of fall-backs and fit, not of limitation: "there are
 * fewer fall-back rides" is a fact about the world; "she can't get there alone" is a
 * verdict about her, and this system does not get to make that one.
 */
export function dignityNote(attrs: EntityAttributes | undefined): string | undefined {
  if (!attrs) return undefined;
  const parts: string[] = [];
  if (attrs.needsAccessibleTransport) {
    parts.push('this needs accessible transport, so there are fewer fall-back rides if it slips');
  }
  if (attrs.requiresAssistance) {
    parts.push('this needs someone who can give hands-on help, so not everyone in the circle can pick it up');
  }
  if (parts.length === 0) return undefined;
  // Capitalise the first clause; join with "and" so it reads as one sentence aloud.
  const joined = parts.join(', and ');
  return `Ranked with extra care because ${joined}.`;
}
