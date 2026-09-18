import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVocabulary, correctTranscript, soundex } from './transcript.ts';

/**
 * The household this demo ships with. Vocabulary is derived from the care record,
 * so these are exactly the terms a live server would produce.
 */
const VOCAB = buildVocabulary({
  members: [{ name: 'Margaret' }, { name: 'David' }, { name: 'Renee' }, { name: 'Tasha' }],
  medications: [{ name: 'heart pill' }, { name: 'thyroid tablet' }],
});

const fix = (s: string) => correctTranscript(s, VOCAB).text;

// --- the errors this exists to fix ---------------------------------------

test('a misheard name is mapped back to the person who exists', () => {
  assert.equal(fix('give the pharmacy run to rainy'), 'give the pharmacy run to Renee');
  assert.equal(fix('ask Tosha to cover the shift'), 'ask Tasha to cover the shift');
});

test('an invented spelling of a real name is corrected', () => {
  assert.equal(fix('tell Renae I will drive'), 'tell Renee I will drive');
  assert.equal(fix('Margarette sounded tired'), 'Margaret sounded tired');
});

test('a medication phrase is corrected as a unit', () => {
  const { text, corrections } = correctTranscript('she took her heart pil', VOCAB);
  assert.equal(text, 'she took her heart pill');
  assert.ok(corrections.some((c) => c.to === 'heart pill'));
});

test('what was changed is reported, not applied silently', () => {
  const { corrections } = correctTranscript('rainy is taking Thursday', VOCAB);
  assert.deepEqual(corrections, [{ from: 'rainy', to: 'Renee' }]);
});

// --- the damage it must never do -----------------------------------------
//
// Every case below is a correction that would be worse than the mistake. A name
// left misheard is a small annoyance; "I'll take it" turned into "I'll Tasha it"
// breaks the sentence this product most needs to understand.

test('ordinary English is never rewritten into a name', () => {
  // "take" and "Tasha" share a Soundex code - this is the collision the
  // untouchable list exists for, and it appears in the most important sentence
  // in the product.
  assert.equal(fix("I'll take it"), "I'll take it");
  assert.equal(fix('she took her pill'), 'she took her pill');
  assert.equal(fix('did she take the dose'), 'did she take the dose');
});

test('a short everyday word is not pulled into a longer name', () => {
  // Found by this suite: "run" and "Renee" share a Soundex code, so
  // "the pharmacy run" became "the pharmacy Renee". Sounding alike is not
  // enough - a candidate has to be about the same length as the name too.
  assert.equal(fix('give the pharmacy run to rainy'), 'give the pharmacy run to Renee');
  assert.equal(fix('the run is done'), 'the run is done');
});

test('a correct transcript is left exactly alone', () => {
  const said = 'Renee is driving Margaret to cardiology on Thursday';
  const { text, corrections } = correctTranscript(said, VOCAB);
  assert.equal(text, said);
  assert.deepEqual(corrections, []);
});

test('an unrelated name is not dragged into the household', () => {
  // Nobody called Sarah is in this circle, so nothing should claim her.
  assert.equal(fix('Sarah from the pharmacy called'), 'Sarah from the pharmacy called');
});

test('short words are never touched', () => {
  assert.equal(fix('is he in'), 'is he in');
});

// --- shape is preserved ---------------------------------------------------

test('capitalisation and punctuation survive a correction', () => {
  assert.equal(fix('Rainy, can you drive?'), 'Renee, can you drive?');
  assert.equal(fix('tell rainy.'), 'tell Renee.');
});

test('spacing is preserved exactly', () => {
  assert.equal(fix('tell   rainy   today'), 'tell   Renee   today');
});

// --- vocabulary ----------------------------------------------------------

test('the vocabulary comes from the care record, including spoken names', () => {
  const vocab = buildVocabulary({
    members: [{ name: 'Margaret Chen', spokenAs: 'Mom' }],
    medications: [{ name: 'metoprolol' }],
  });
  assert.ok(vocab.includes('Margaret Chen'));
  assert.ok(vocab.includes('Mom'));
  assert.ok(vocab.includes('metoprolol'));
});

test('an empty vocabulary changes nothing', () => {
  assert.equal(correctTranscript('anything at all', []).text, 'anything at all');
});

test('soundex groups the mishearings we actually see', () => {
  assert.equal(soundex('rainy'), soundex('Renee'));
  assert.equal(soundex('Tosha'), soundex('Tasha'));
});
