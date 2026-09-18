import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { frames, hasEnoughAudio, signature, unhyphenate, vocabularyPhrases, SAMPLE_RATE } from './transcribe.ts';

/**
 * The parts worth testing without calling AWS: how audio is cut up, and how a
 * multi-word name survives the round trip through a vocabulary that only accepts
 * single tokens.
 */

test('frames never split a 16-bit sample', () => {
  // An odd-length buffer would otherwise cut a sample in half and turn the tail
  // of every utterance into noise.
  const odd = Buffer.alloc(3_201);
  const total = frames(odd).reduce((n, f) => n + f.length, 0);
  assert.equal(total % 2, 0);
  assert.equal(total, 3_200);
});

test('frames cover the whole buffer', () => {
  const pcm = Buffer.alloc(10_000);
  assert.equal(frames(pcm).reduce((n, f) => n + f.length, 0), 10_000);
});

test('a stray tap on the mic is not sent anywhere', () => {
  assert.equal(hasEnoughAudio(Buffer.alloc(200)), false);
  assert.equal(hasEnoughAudio(Buffer.alloc(SAMPLE_RATE)), true); // 0.5s of 16-bit
});

test('multi-word names are hyphenated for the vocabulary', () => {
  assert.deepEqual(vocabularyPhrases(['heart pill', 'Renee']), ['heart-pill', 'Renee']);
});

test('names that a vocabulary cannot hold are dropped rather than corrupting it', () => {
  assert.deepEqual(vocabularyPhrases(['ok!', 'a', '', 'Renee']), ['Renee']);
});

test('hyphenated names come back as they are spoken', () => {
  assert.equal(
    unhyphenate('she took her heart-pill', ['heart pill']),
    'she took her heart pill',
  );
});

test('single-word names are left alone by unhyphenation', () => {
  assert.equal(unhyphenate('Renee is driving', ['Renee']), 'Renee is driving');
});

test('a reordered vocabulary is not treated as a change', () => {
  // Rebuilding on every restart would leave the vocabulary PENDING - and so
  // unusable - for a minute each time, for no reason.
  assert.equal(signature(['Renee', 'David']), signature(['David', 'renee']));
});

test('a household that gained a member is a change', () => {
  assert.notEqual(signature(['Renee', 'David']), signature(['Renee', 'David', 'Tasha']));
});
