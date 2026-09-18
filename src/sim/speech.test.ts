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
