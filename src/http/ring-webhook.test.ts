import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { SeenEvents, verifySignature } from './ring-webhook.ts';

/**
 * The Ring webhook is a PUBLIC, unauthenticated URL that writes into a family's
 * medical record. Everything here is an attack on that fact.
 */

const KEY = 'test-ring-hmac-key';
const store = new CareStore();
let server: Server;
let base: string;

function sign(body: string): string {
  return createHmac('sha256', KEY).update(body).digest('hex');
}

function motion(requestId: string, subType = 'human'): string {
  return JSON.stringify({
    data: {
      type: 'motion_detected',
      id: `evt_${requestId}`,
      attributes: { created_at: new Date().toISOString(), sub_type: subType },
      relationships: { device: { data: { id: 'dev_front_door' } } },
    },
    meta: { request_id: requestId, account_id: 'acct_1' },
  });
}

async function post(body: string, signature?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/ring/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'x-signature': signature }),
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeEach(async () => {
  process.env['RING_HMAC_KEY'] = KEY;
  process.env['RING_HOUSEHOLD_ID'] = 'h_margaret';
  await store.reset();
  await seedDemoHousehold(store);
  server?.close();
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
      resolve();
    });
  });
});

// Without this the last server stays listening and the test process never exits.
after(() => { server?.close(); });

test('an unsigned event is refused', async () => {
  // Without this, a stranger with the URL could write into a family's care record.
  const { status } = await post(motion('r1'));
  assert.equal(status, 401);
});

test('a wrong signature is refused', async () => {
  const { status } = await post(motion('r2'), 'deadbeef');
  assert.equal(status, 401);
});

test('a signature over different bytes is refused', async () => {
  // Signature valid for one body, presented with another.
  const { status } = await post(motion('r3'), sign(motion('r4')));
  assert.equal(status, 401);
});

test('a correctly signed event is accepted and becomes a proposal', async () => {
  const body = motion('r5');
  const { status, json } = await post(body, sign(body));
  assert.equal(status, 200);
  assert.equal(json.status, 'accepted');
  assert.ok(json.eventId);
});

test('a redelivered event is acknowledged but not acted on twice', async () => {
  // Ring retries. A duplicated "package arrived" is a duplicated proposal on a
  // family's care board.
  const body = motion('r6');
  const first = await post(body, sign(body));
  const second = await post(body, sign(body));
  assert.equal(first.json.status, 'accepted');
  assert.equal(second.status, 200, 'a duplicate must still return 200 or Ring retries forever');
  assert.equal(second.json.status, 'duplicate');
});

test('an event Ring sends that we do not act on is still acknowledged', async () => {
  const body = JSON.stringify({
    data: { type: 'device_online', id: 'evt_x', attributes: {} },
    meta: { request_id: 'r7' },
  });
  const { status, json } = await post(body, sign(body));
  assert.equal(status, 200);
  assert.equal(json.status, 'ignored');
});

test('a signed but non-JSON body is rejected without crashing', async () => {
  const body = 'not json at all';
  const { status } = await post(body, sign(body));
  assert.equal(status, 400);
});

test('a sensor never resolves work on its own', async () => {
  const body = motion('r8', 'package');
  const { json } = await post(body, sign(body));
  // It may NAME work it is evidence toward, but must not close it.
  const state = store.getCareState('h_margaret');
  assert.ok(!state.obligations.some((o) => o.status === 'RESOLVED'),
    'a Ring event must never resolve an obligation');
  if (json.proposalId) {
    const proposed = state.obligations.find((o) => o.id === json.proposalId);
    assert.equal(proposed?.status, 'PROPOSED');
    assert.equal(proposed?.provenance.kind, 'INFERRED');
  }
});

// --- units ---------------------------------------------------------------

test('signature comparison survives a length mismatch', () => {
  // timingSafeEqual throws on unequal lengths; this must return false, not throw.
  assert.equal(verifySignature(Buffer.from('{}'), 'ab', KEY), false);
  assert.equal(verifySignature(Buffer.from('{}'), undefined, KEY), false);
  assert.equal(verifySignature(Buffer.from('{}'), sign('{}'), ''), false);
});

test('a sha256= prefix is tolerated', () => {
  const body = '{"a":1}';
  assert.equal(verifySignature(Buffer.from(body), `sha256=${sign(body)}`, KEY), true);
});

test('the idempotency cache is bounded', () => {
  // An unbounded set on a public endpoint is a way to be run out of memory.
  const seen = new SeenEvents(3);
  assert.equal(seen.admit('a'), true);
  assert.equal(seen.admit('a'), false);
  seen.admit('b'); seen.admit('c'); seen.admit('d');
  assert.equal(seen.admit('a'), true, 'the oldest key should have been evicted');
});
