/**
 * Who says so.
 *
 * "Known != Assumed" already stops the system turning a silence into an
 * accusation. This is the same principle one level deeper: **someone else's
 * account of you must not masquerade as your own account of yourself.**
 *
 * The care record captures both halves already - `reportedBy` is whoever spoke,
 * `data.aboutMemberId` is whoever it concerns - and until now nothing downstream
 * read them together. A dose Alex logged and a dose the aide logged on Alex's
 * behalf produced byte-identical output. That is a real failure, and it falls
 * hardest on the people least able to correct the record: someone using AAC, or
 * with limited speech, or whose day is largely narrated by other people. "The
 * aide says you took it" and "you say you took it" are different claims, and the
 * difference can bear on benefits, on a compliance finding, and on whether
 * anybody believes you.
 *
 * ## The rule that is easy to get wrong
 *
 * A proxy record still **fully closes** the gap. It is a record, made by a person,
 * and treating it as weaker evidence would mean the system quietly disbelieving
 * the aide - which is the same accusation from the other direction, and it would
 * punish exactly the households that rely on proxies most.
 *
 * So the distinction lives in the **language, never in the doubt**. We always say
 * who says so. We never say we are less sure.
 */

import type { CareEvent } from './types.ts';

export type Attribution =
  /** The person spoke for themselves. The strongest thing the record holds. */
  | { kind: 'FIRST_HAND'; memberId: string }
  /** Somebody spoke about somebody else. Still a record; a different claim. */
  | { kind: 'REPORTED'; byMemberId: string; aboutMemberId: string };

/**
 * Read an event's attribution.
 *
 * `aboutMemberId` is absent on events logged about oneself, which is the common
 * case, so its absence means the speaker is also the subject.
 */
export function attributionOf(event: CareEvent): Attribution {
  const about = typeof event.data['aboutMemberId'] === 'string'
    ? (event.data['aboutMemberId'] as string)
    : event.reportedBy;
  return about === event.reportedBy
    ? { kind: 'FIRST_HAND', memberId: about }
    : { kind: 'REPORTED', byMemberId: event.reportedBy, aboutMemberId: about };
}

export function isReported(event: CareEvent): boolean {
  return attributionOf(event).kind === 'REPORTED';
}

/** Resolve a member id to how they are spoken about. Returns null if unknown. */
export type NameOf = (memberId: string) => string | null;

/**
 * Say who says so, in a phrase that can sit inside a spoken sentence.
 *
 * First-hand records are phrased as the person's own act, because the alternative
 * ("Alex logged that Alex took it") is stilted and, worse, subtly distancing - it
 * reads like a file note about someone rather than something they told you.
 *
 * `they/them` throughout: the record holds names and roles, never pronouns, and
 * guessing someone's pronoun from their name is a worse failure than the neutral
 * form in a product whose entire premise is not asserting things it does not know.
 */
export function sayWhoSaysSo(attribution: Attribution, nameOf: NameOf): string {
  if (attribution.kind === 'FIRST_HAND') {
    return `${nameOf(attribution.memberId) ?? 'They'} logged it themselves`;
  }
  const by = nameOf(attribution.byMemberId) ?? 'Someone';
  const about = nameOf(attribution.aboutMemberId) ?? 'them';
  return `${by} logged it for ${about}`;
}

/**
 * The invariant, as a predicate, so tests and the eval corpus can both use it.
 *
 * A spoken line that reports a proxy record without naming the reporter has
 * silently upgraded somebody's account of you into your own. A first-hand record
 * carries no such obligation - there is nobody else in the claim to name.
 */
export function namesItsSource(spoken: string, attribution: Attribution, nameOf: NameOf): boolean {
  if (attribution.kind !== 'REPORTED') return true;
  const by = nameOf(attribution.byMemberId);
  return !!by && spoken.includes(by);
}
