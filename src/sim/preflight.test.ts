import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, describe as describeDiagnosis, type QuotaFact } from './preflight.ts';

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
