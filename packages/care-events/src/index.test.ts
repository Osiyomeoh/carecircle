import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careEvent, ringAdapter, beeAdapter } from './index.ts';

test('a builder fills an id and a timestamp, and keeps provenance honest', () => {
  const e = careEvent({ source: 'alexa', kind: 'medication', provenance: { kind: 'CONFIRMED', by: 'm', at: '2026-01-01T00:00:00Z' } });
  assert.ok(e.id.startsWith('ce_alexa'));
  assert.ok(e.occurredAt);
  assert.equal(e.provenance.kind, 'CONFIRMED');
});

test('a Ring package delivery is evidence (INFERRED), never a conclusion', () => {
  const [e] = ringAdapter.adapt({ type: 'motion_detected', sub_type: 'package_delivery', request_id: 'r1' });
  assert.equal(e.kind, 'delivery');
  assert.equal(e.provenance.kind, 'INFERRED');
  assert.equal(e.id, 'ce_ring_r1'); // idempotent on request_id
});

test('an unknown Ring event is ignored, not mismapped', () => {
  assert.equal(ringAdapter.adapt({ type: 'battery_low' }).length, 0);
});

test('a Bee fact and a Ring event become the same kind of thing to the engine', () => {
  const bee = beeAdapter.adapt({ text: 'needs bloodwork before Thursday', id: 'b1' });
  const ring = ringAdapter.adapt({ type: 'ding' });
  assert.equal(bee[0]!.provenance.kind, 'INFERRED');
  assert.equal(ring[0]!.provenance.kind, 'INFERRED');
  // Both are CareEvents with a source and honest provenance - indistinguishable downstream.
  for (const e of [bee[0]!, ring[0]!]) {
    assert.ok(e.id && e.source && e.occurredAt && e.provenance);
  }
});

test('an empty Bee fact yields nothing rather than a hollow event', () => {
  assert.equal(beeAdapter.adapt({ text: '  ' }).length, 0);
});
