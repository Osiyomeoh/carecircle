import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretSignal, noActivityWarranted, type CareSignal } from './signals.ts';
import type { CareEvent } from './types.ts';

const ctx = { recipientId: 'm_margaret', recipientName: 'Mom', now: new Date('2026-10-15T18:00:00Z') };
const sig = (over: Partial<CareSignal>): CareSignal =>
  ({ source: 'ring', kind: 'motion', at: '2026-10-15T18:00:00Z', ...over });

test('a delivery is evidence toward the prescription, and asks - never auto-resolves', () => {
  // The beat: "Was Mom's prescription picked up?" answered by the doorbell.
  const out = interpretSignal(sig({ kind: 'delivery_arrived' }), ctx);
  assert.ok(out.resolvesObligationLike);
  assert.equal(out.resolvesObligationLike.match, 'prescription');
  assert.match(out.resolvesObligationLike.ask, /should I mark it picked up/i);
  // Evidence, not a verdict: nothing here resolves anything on its own.
  assert.ok(!('proposeObligation' in out) || out.proposeObligation === undefined);
});

test('a device signal is recorded as observed, on its own channel', () => {
  // Event-level provenance: a signal enters as `observed` on the device's channel,
  // never at a confidence a person's report would carry. What it MEANS stays a proposal.
  const fromRing = interpretSignal(sig({ kind: 'delivery_arrived' }), ctx).event;
  assert.equal(fromRing.source, 'ring');
  assert.equal(fromRing.confidence, 'observed');

  const fromOther = interpretSignal(sig({ source: 'other', kind: 'motion' }), ctx).event;
  assert.equal(fromOther.source, 'device');
  assert.equal(fromOther.confidence, 'observed');
});

test('no activity proposes a check-in, framed as absence not alarm', () => {
  // The inverse beat: an obligation created by a physical absence.
  const out = interpretSignal(sig({ kind: 'no_activity' }), ctx);
  assert.ok(out.proposeObligation);
  assert.match(out.proposeObligation.what, /Check in on Mom/);
  // Known != Assumed, at the sensor boundary too.
  assert.match(out.proposeObligation.ask, /I don't know that anything is wrong/i);
  assert.doesNotMatch(out.spoken, /collapsed|fell|emergency|wrong|hurt/i);
  assert.match(out.spoken, /no activity.*has been recorded/i);
});

test('door activity is recorded but proposes nothing', () => {
  const out = interpretSignal(sig({ kind: 'door_activity' }), ctx);
  assert.equal(out.proposeObligation, undefined);
  assert.equal(out.resolvesObligationLike, undefined);
  assert.equal(out.event.kind, 'external_signal');
  assert.equal(out.event.reportedBy, 'device:ring');
});

test('a signal is attributed to the device, never to a person', () => {
  const out = interpretSignal(sig({ kind: 'delivery_arrived', raw: { ringEventId: 'evt_9' } }), ctx);
  assert.equal(out.event.reportedBy, 'device:ring');
  assert.equal(out.event.data['source'], 'ring');
  assert.deepEqual(out.event.data['raw'], { ringEventId: 'evt_9' });
});

const signalEvent = (kind: string, at: string): CareEvent => ({
  id: 'e', householdId: 'h', kind: 'external_signal', reportedBy: 'device:ring',
  occurredAt: at, recordedAt: at, data: { signalKind: kind },
});

test('no-activity concern only after enough of the day has passed', () => {
  const tz = 'America/New_York';
  // 09:00 New York - too early to be notable.
  assert.equal(noActivityWarranted([], new Date('2026-10-15T13:00:00Z'), tz), false);
  // 14:00 New York - warranted when nothing was seen.
  assert.equal(noActivityWarranted([], new Date('2026-10-15T18:00:00Z'), tz), true);
});

test('any activity today clears the no-activity concern', () => {
  const tz = 'America/New_York';
  const today = [signalEvent('door_activity', '2026-10-15T13:30:00Z')]; // 09:30 NY
  assert.equal(noActivityWarranted(today, new Date('2026-10-15T18:00:00Z'), tz), false);
});
