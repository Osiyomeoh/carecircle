import type { CareGap, Obligation } from '../domain/types.js';

/**
 * Turning structured state into sentences a voice assistant can say verbatim.
 *
 * Everything here assumes the result will be *spoken*. That imposes constraints a
 * chat surface does not have: no markdown, no ids read aloud, no lists longer than
 * a person can hold in their head. When there is more than we should say, we say
 * how much more instead of reciting it.
 */

/** Beyond this, a spoken list stops being usable and starts being noise. */
export const SPOKEN_LIST_LIMIT = 3;

export function joinSpoken(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

/** Small numbers read better as words when spoken aloud. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

export function countPhrase(n: number, singular: string, plural = `${singular}s`): string {
  if (n === 0) return `no ${plural}`;
  if (n === 1) return `one ${singular}`;
  return `${numberWord(n)} ${plural}`;
}

/** Capitalise the first letter, for a phrase that begins a spoken sentence. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Render care gaps for speech, most urgent first, truncated to what a person can
 * actually absorb. The remainder is counted rather than listed.
 */
export function speakGaps(gaps: CareGap[]): string {
  if (gaps.length === 0) {
    return "Nothing is unassigned right now - everything that's been recorded has someone on it.";
  }
  const shown = gaps.slice(0, SPOKEN_LIST_LIMIT);
  const lead = gaps.length === 1
    ? "There's one thing that needs an owner."
    : `There are ${numberWord(gaps.length)} things that need attention.`;
  const body = shown.map((g) => g.spoken).join(' ');
  const rest = gaps.length > shown.length
    ? ` There ${gaps.length - shown.length === 1 ? 'is' : 'are'} ${numberWord(gaps.length - shown.length)} more if you want to hear them.`
    : '';
  return `${lead} ${body}${rest}`;
}

export function speakObligation(o: Obligation, ownerName?: string): string {
  if (o.status === 'RESOLVED') return `${o.what} is done.`;
  if (o.ownerId && ownerName) return `${o.what} - ${ownerName} has it.`;
  if (o.status === 'PROPOSED') return `${o.what} - not confirmed yet.`;
  return `${o.what} - nobody has taken it yet.`;
}
