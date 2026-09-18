import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRate, RATES, toSsml } from './speech.ts';

test('a care note containing markup cannot break the SSML', () => {
  // Notes are free text written by whoever is in the house.
  const ssml = toSsml('Tell <b>David</b> "it\'s 5 & rising"');
  assert.ok(!/<b>/.test(ssml));
  assert.match(ssml, /&lt;b&gt;/);
  assert.match(ssml, /&amp;/);
  assert.match(ssml, /&quot;|&apos;/);
});

test('sentences are given room to breathe', () => {
  const ssml = toSsml('Cardiology is Thursday. David is driving.');
  assert.match(ssml, /<break time="350ms"\/>/);
});

test('slow speech is genuinely slower, for listeners who need it', () => {
  assert.match(toSsml('hello', 'slow'), /rate="75%"/);
  assert.match(toSsml('hello', 'normal'), /rate="100%"/);
  assert.ok(Number.parseInt(RATES.slow, 10) < Number.parseInt(RATES.normal, 10));
});

test('an unknown rate is rejected rather than passed to Polly', () => {
  assert.equal(isRate('slow'), true);
  assert.equal(isRate('turbo'), false);
  assert.equal(isRate(undefined), false);
});

test('the markup is well-formed even for a single word', () => {
  const ssml = toSsml('Done');
  assert.match(ssml, /^<speak><prosody rate="100%">Done<\/prosody><\/speak>$/);
});

test('the three paces are genuinely distinct', () => {
  // Polly's generative engine quantizes prosody rate and says nothing when it
  // drops one: `gentle` at 90% returned audio byte-identical to `normal`, and at
  // 80% byte-identical to `slow`. An accessibility control that silently does
  // nothing is worse than an absent one, so distinctness is asserted, not assumed.
  const said = (['slow', 'gentle', 'normal'] as const).map((r) => toSsml('One. Two.', r));
  assert.equal(new Set(said).size, 3, 'each pace must produce different speech');
});

test('gentle is the same speed with more room to breathe', () => {
  // Not a slightly slower voice - there is no percentage that survives the engine's
  // quantization as a middle speed. Longer pauses do the work instead, and for a
  // listener parsing a date and a name they arguably do it better.
  assert.match(toSsml('One. Two.', 'gentle'), /rate="100%"/);
  assert.match(toSsml('One. Two.', 'gentle'), /<break time="600ms"\/>/);
  assert.match(toSsml('One. Two.', 'slow'), /rate="75%"/);
});
