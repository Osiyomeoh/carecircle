/**
 * Deciding when somebody has finished speaking.
 *
 * The Transcribe path used to record until you tapped Stop. That is fine at a
 * keyboard and wrong everywhere else: the whole premise is that speech is the
 * only channel some people have, and a mic that needs a second deliberate tap to
 * release is a mic that needs hands and attention. Nobody talks to a kitchen
 * Echo and then reaches over to end the sentence.
 *
 * So this watches the level and calls the end of the turn itself. It is a pure
 * function of (elapsed, peak) so the thresholds can be tested against a script of
 * a real conversation rather than by talking at a laptop and hoping.
 *
 * The thresholds are set for the people this is built for, which means erring
 * towards waiting:
 *
 *  - SILENCE_MS is long. Someone recalling whether a dose was taken this morning
 *    pauses mid-sentence, and cutting them off at a brisk 700ms would send half a
 *    question to Transcribe. A second and a half of nothing is a real stop.
 *  - Nothing is ever endpointed before speech is heard. An empty room stays open
 *    for PATIENCE_MS, because somebody may still be getting to the mic.
 *  - The cap exists so a stuck stream cannot record forever, not as a turn limit.
 *
 * Manual stop still works and still wins. This only removes the *requirement*.
 */

/** Peak level above which we call it speech rather than room noise. */
export const SPEECH_PEAK = 0.045;
/** Silence after speech that ends the turn. */
export const SILENCE_MS = 1_500;
/** How long to wait for a first word before giving up on an empty room. */
export const PATIENCE_MS = 9_000;
/** Hard ceiling, so a wedged stream cannot record until the tab dies. */
export const MAX_MS = 45_000;

export type Ending = 'silence' | 'nothing' | 'cap';

export interface Ear {
  /** Whether we have heard anything loud enough to count as speech. */
  heard: boolean;
  /** Elapsed ms at the last loud sample; 0 before any. */
  lastLoud: number;
  /** Set once we have ended, so an ending is announced exactly once. */
  done: boolean;
}

export const FRESH: Ear = { heard: false, lastLoud: 0, done: false };

export interface Heard {
  ear: Ear;
  /** Non-null exactly once, on the sample that ends the turn. */
  end: Ending | null;
}

/**
 * Fold one audio frame in.
 *
 * `elapsed` is ms since recording started and `peak` is the frame's peak
 * amplitude in [0, 1] - the same number the level meter already draws, so what
 * the listener sees on screen is what this decides on.
 */
export function hear(ear: Ear, elapsed: number, peak: number): Heard {
  if (ear.done) return { ear, end: null };

  const loud = peak >= SPEECH_PEAK;
  const next: Ear = {
    heard: ear.heard || loud,
    lastLoud: loud ? elapsed : ear.lastLoud,
    done: false,
  };

  const end = (reason: Ending): Heard => ({ ear: { ...next, done: true }, end: reason });

  // The cap is checked first: it holds even mid-sentence, because at that point
  // something is wrong with the stream rather than with the speaker.
  if (elapsed >= MAX_MS) return end('cap');
  if (!next.heard) return elapsed >= PATIENCE_MS ? end('nothing') : { ear: next, end: null };
  return elapsed - next.lastLoud >= SILENCE_MS ? end('silence') : { ear: next, end: null };
}
