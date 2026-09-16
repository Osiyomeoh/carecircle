import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringEventToSignal, ringIdempotencyKey, type RingEvent } from './ring.ts';

const ev = (over: Partial<RingEvent['data']> = {}, meta: RingEvent['meta'] = {}): RingEvent => ({
  data: { type: 'motion_detected', id: 'evt_1',
    attributes: { created_at: '2026-10-15T18:00:00Z' },
    relationships: { device: { data: { id: 'dev_front' } } }, ...over },
  meta: { request_id: 'req_1', ...meta },
});

test('a package-motion event becomes a delivery signal', () => {
  const s = ringEventToSignal(ev({ attributes: { created_at: '2026-10-15T18:00:00Z', sub_type: 'package' } }));
  assert.ok(s);
  assert.equal(s.kind, 'delivery_arrived');
  assert.equal(s.source, 'ring');
  assert.equal(s.raw?.['deviceId'], 'dev_front');
  assert.equal(s.raw?.['requestId'], 'req_1');
});

test('a human-motion event is a sign of life, not a delivery', () => {
  const s = ringEventToSignal(ev({ attributes: { created_at: '2026-10-15T18:00:00Z', sub_type: 'human' } }));
  assert.equal(s?.kind, 'motion');
});

test('a doorbell press is door activity', () => {
  const s = ringEventToSignal(ev({ type: 'button_press' }));
  assert.equal(s?.kind, 'door_activity');
});

test('non-care Ring events are ignored, not mismapped', () => {
  // Ring emits presence, never absence — and plenty of events are irrelevant.
  for (const type of ['device_online', 'subscription_activated', 'app_integration_added']) {
    assert.equal(ringEventToSignal(ev({ type })), null, `${type} should map to nothing`);
  }
});

test('idempotency key prefers request_id, so a redelivered webhook is not double-counted', () => {
  assert.equal(ringIdempotencyKey(ev()), 'req_1');
  assert.equal(ringIdempotencyKey(ev({}, { request_id: undefined })), 'evt_1');
});

test('a malformed event does not throw', () => {
  assert.doesNotThrow(() => ringEventToSignal({} as RingEvent));
  assert.equal(ringEventToSignal({} as RingEvent), null);
});
