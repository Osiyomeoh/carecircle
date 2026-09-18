import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH, hear, SPEECH_PEAK, SILENCE_MS, PATIENCE_MS, MAX_MS,
  type Ear, type Ending,
} from '../sim-ui/src/lib/endpoint.ts';

/** One audio frame is ~256ms at 4096 samples / 16kHz, which is what the mic delivers. */
const FRAME = 256;

const LOUD = SPEECH_PEAK + 0.2;
const ROOM = SPEECH_PEAK / 3;

/**
 * Play a script of (durationMs, peak) at the endpointer, a frame at a time, and
 * report where it decided the turn ended.
 */
function play(script: Array<[number, number]>): { end: Ending | null; at: number } {
  let ear: Ear = FRESH;
  let elapsed = 0;
  for (const [ms, peak] of script) {
    for (let t = 0; t < ms; t += FRAME) {
      elapsed += FRAME;
      const step = hear(ear, elapsed, peak);
      ear = step.ear;
      if (step.end) return { end: step.end, at: elapsed };
    }
  }
  return { end: null, at: elapsed };
}

test('a normal question ends on its own, without anyone tapping stop', () => {
  const { end } = play([[2_000, LOUD], [3_000, ROOM]]);
  assert.equal(end, 'silence');
});

test('the turn ends shortly after the speaker does, not seconds later', () => {
  const spoke = 2_000;
  const { at } = play([[spoke, LOUD], [5_000, ROOM]]);
  // Allow a frame of slack either side of the threshold.
  assert.ok(at >= spoke + SILENCE_MS, `ended too early at ${at}ms`);
  assert.ok(at <= spoke + SILENCE_MS + FRAME * 2, `ended too late at ${at}ms`);
});

test('a pause mid-sentence is not the end of the sentence', () => {
  // "Did Mom take her heart pill ... this morning?" - a real pause while recalling.
  const { end } = play([
    [1_500, LOUD],
    [SILENCE_MS - 400, ROOM],
    [1_500, LOUD],
  ]);
  assert.equal(end, null, 'cut the speaker off in the middle of a question');
});

test('the pause someone needs is longer than a brisk endpointer would allow', () => {
  // The specific regression guarded here: 700ms is a common default and is too
  // short for the people this is built for.
  assert.ok(SILENCE_MS >= 1_200, 'silence window is too aggressive for slow speech');
});

test('an empty room gives up rather than recording forever', () => {
  const { end, at } = play([[PATIENCE_MS + 5_000, ROOM]]);
  assert.equal(end, 'nothing');
  assert.ok(at >= PATIENCE_MS);
});

test('someone slow to start is still waited for', () => {
  const { end } = play([[PATIENCE_MS - 2_000, ROOM], [2_000, LOUD], [3_000, ROOM]]);
  assert.equal(end, 'silence', 'gave up on someone who was still getting to the mic');
});

test('silence before any speech is never reported as the speaker stopping', () => {
  // 'nothing' and 'silence' are handled differently by the caller: one discards
  // the audio, the other sends it. Confusing them sends an empty clip to Transcribe.
  const { end } = play([[PATIENCE_MS + 1_000, ROOM]]);
  assert.notEqual(end, 'silence');
});

test('a wedged stream cannot record until the tab dies', () => {
  const { end, at } = play([[MAX_MS + 10_000, LOUD]]);
  assert.equal(end, 'cap');
  assert.ok(at >= MAX_MS);
});

test('the ending is announced exactly once', () => {
  let ear: Ear = FRESH;
  let endings = 0;
  for (let elapsed = FRAME; elapsed <= MAX_MS + 20_000; elapsed += FRAME) {
    const peak = elapsed < 2_000 ? LOUD : ROOM;
    const step = hear(ear, elapsed, peak);
    ear = step.ear;
    if (step.end) endings++;
  }
  assert.equal(endings, 1);
});

test('a level right at the threshold counts as speech', () => {
  const step = hear(FRESH, FRAME, SPEECH_PEAK);
  assert.equal(step.ear.heard, true);
});

test('room noise alone never counts as somebody talking', () => {
  let ear: Ear = FRESH;
  for (let elapsed = FRAME; elapsed < PATIENCE_MS; elapsed += FRAME) {
    ear = hear(ear, elapsed, ROOM).ear;
  }
  assert.equal(ear.heard, false);
});
