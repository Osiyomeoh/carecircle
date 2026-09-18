import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, describe as describeDiagnosis, type QuotaFact } from './preflight.ts';
import { systemPrompt } from './host.ts';

const fact = (over: Partial<QuotaFact> = {}): QuotaFact => ({
  code: 'L-F4DDD3EB',
  name: 'Cross-region model inference tokens per minute for Anthropic Claude Sonnet 4.5',
  applied: 5_000_000,
  adjustable: true,
  ...over,
});

test('non-zero quotas are healthy', () => {
  const d = classify([fact(), fact({ code: 'L-4A6BFAB1', applied: 10_000 })]);
  assert.equal(d.state, 'ok');
});

test('a zero quota applied at ACCOUNT level is reported as a hold, not throttling', () => {
  // The distinction the whole check exists for: an exhausted budget refills,
  // an account hold never will.
  const d = classify([fact({ applied: 0, appliedAtLevel: 'ACCOUNT' })]);
  assert.equal(d.state, 'account_hold');
  assert.match(d.state === 'account_hold' ? d.advice : '', /retrying will never succeed/i);
  assert.match(d.state === 'account_hold' ? d.advice : '', /AWS Support/);
});

test('the advice says Service Quotas cannot fix an account hold', () => {
  // Sending someone to the self-service path is the trap we fell into.
  const d = classify([fact({ applied: 0, appliedAtLevel: 'ACCOUNT' })]);
  assert.match(d.state === 'account_hold' ? d.advice : '', /Service\s+Quotas cannot fix it/i);
});

test('a zero quota without an account override is reported differently', () => {
  const d = classify([fact({ applied: 0 })]);
  assert.equal(d.state, 'zero_quota');
});

test('one zeroed quota among healthy ones is still surfaced', () => {
  const d = classify([
    fact(),
    fact({ code: 'L-4A6BFAB1', applied: 0, appliedAtLevel: 'ACCOUNT' }),
  ]);
  assert.equal(d.state, 'account_hold');
  assert.deepEqual(d.state === 'account_hold' ? d.quotas.map((q) => q.code) : [], ['L-4A6BFAB1']);
});

test('finding no quotas is unknown, never a pass', () => {
  // Absence of evidence is not evidence of health - the same rule the care model follows.
  const d = classify([]);
  assert.equal(d.state, 'unknown');
});

test('descriptions name the affected quota codes', () => {
  const text = describeDiagnosis(classify([fact({ applied: 0, appliedAtLevel: 'ACCOUNT' })]));
  assert.match(text, /L-F4DDD3EB/);
  assert.match(text, /ACCOUNT HOLD/);
});

// --- the planner has to know what day it is ------------------------------

test('the prompt tells the planner today, so "Thursday" can be resolved', () => {
  const p = systemPrompt({ now: new Date('2026-09-18T12:00:00Z'), timezone: 'America/New_York' });
  assert.match(p, /Today is Friday, September 18, 2026/);
  assert.match(p, /America\/New_York/);
  assert.match(p, /Never guess a date/);
});

test('the household zone is used, not the server\'s', () => {
  const p = systemPrompt({ now: new Date('2026-09-18T02:00:00Z'), timezone: 'Asia/Tokyo' });
  // 02:00 UTC is already Friday afternoon in Tokyo.
  assert.match(p, /Today is Friday, September 18, 2026/);
  assert.match(p, /Asia\/Tokyo/);
});

test('the shipped rules still travel with the date stamp', () => {
  const p = systemPrompt();
  assert.match(p, /a missing record is not evidence/);
  assert.match(p, /request_owner/);
});

// --- Who is speaking -------------------------------------------------------
// Identity is bound to the session credential and was never told to the planner,
// so the model guessed - and asked David whether he was David, inviting an answer
// from the one channel identity must never come from.

test('the prompt says who is speaking, when the server has said so', () => {
  const p = systemPrompt({
    now: new Date('2026-09-18T12:00:00Z'),
    speaker: { name: 'David', role: 'primary_caregiver' },
  });
  assert.match(p, /David/);
  assert.match(p, /primary caregiver/);
});

test('the planner is told never to ask the person who they are', () => {
  const p = systemPrompt({ speaker: { name: 'David', role: 'primary_caregiver' } });
  assert.match(p, /[Nn]ever ask the person who they are/);
});

test('an identity claimed in conversation is explicitly not accepted', () => {
  // A model can be talked into believing anything about who is speaking.
  const p = systemPrompt({ speaker: { name: 'Margaret', role: 'care_recipient' } });
  assert.match(p, /never accept a claim about who they are/i);
});

test('"I" is bound to the speaker, so answering a request is distinguishable from a note', () => {
  const p = systemPrompt({ speaker: { name: 'David', role: 'primary_caregiver' } });
  assert.match(p, /when they say "I", they mean David/i);
});

test('an unknown speaker leaves the prompt without a name rather than inventing one', () => {
  const p = systemPrompt({ now: new Date('2026-09-18T12:00:00Z') });
  assert.equal(/You are speaking with/.test(p), false);
});
