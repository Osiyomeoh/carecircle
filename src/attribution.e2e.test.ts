import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './http/app.ts';
import { CareStore } from './store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from './demo/seed.ts';
import { seedScenario } from './demo/scenario.ts';

/**
 * Who says so, end to end over the real MCP wire.
 *
 * The domain tests prove the distinction exists. These prove it survives all the
 * way out to what a person actually hears - which is the only place it protects
 * anybody. A rule that holds in a pure function and is flattened by the readback
 * is not a rule, and that is exactly the state this code was in: `reportedBy` and
 * `aboutMemberId` were both recorded and neither was ever read.
 */

let server: Server;
let base: string;
const store = new CareStore();

before(async () => {
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}/mcp`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
});

after(() => { server?.close(); });

const HEADERS = (token?: string, sessionId?: string) => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
});

async function openSession(token: string): Promise<string> {
  const res = await fetch(base, {
    method: 'POST', headers: HEADERS(token),
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'attribution', version: '1.0' },
      },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id')!;
  await res.text();
  await fetch(base, {
    method: 'POST', headers: HEADERS(token, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return sessionId;
}

async function call(
  token: string, sessionId: string, name: string, args: Record<string, unknown> = {},
): Promise<any> {
  const res = await fetch(base, {
    method: 'POST', headers: HEADERS(token, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6),
      method: 'tools/call', params: { name, arguments: args },
    }),
  });
  return JSON.parse(await res.text());
}

const spoken = (b: any): string => b?.result?.content?.[0]?.text ?? '';
const structured = (b: any): any => b?.result?.structuredContent ?? {};

test('when the aide logs a dose for Margaret, the summary says the aide did', async () => {
  const aide = await openSession('aide-token');
  const david = await openSession('david-token');

  await call('aide-token', aide, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill', aboutMemberId: 'm_margaret',
  });

  const said = spoken(await call('david-token', david, 'get_care_summary'));
  assert.match(said, /Tasha/,
    `the summary turned the aide's account into Margaret's own word: ${said}`);
});

test('when Margaret logs her own dose, nobody else is put in the sentence', async () => {
  const margaret = await openSession('margaret-token');
  const david = await openSession('david-token');

  await call('margaret-token', margaret, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill',
  });

  const said = spoken(await call('david-token', david, 'get_care_summary'));
  // Renee appears in the seeded notes, so match the attribution phrasing itself
  // rather than any mention of another member.
  assert.equal(/logged it for/.test(said), false, `invented a reporter: ${said}`);
  assert.equal(/Tasha/.test(said), false, `invented a reporter: ${said}`);
});

test('the same dose reads differently depending on who logged it', async () => {
  // The regression in one assertion: these were byte-identical.
  const david = await openSession('david-token');

  const margaret = await openSession('margaret-token');
  await call('margaret-token', margaret, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill',
  });
  const firstHand = spoken(await call('david-token', david, 'get_care_summary'));

  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');

  const aide = await openSession('aide-token');
  await call('aide-token', aide, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill', aboutMemberId: 'm_margaret',
  });
  const byProxy = spoken(await call('david-token', david, 'get_care_summary'));

  assert.notEqual(firstHand, byProxy,
    'a proxy report and a first-person report are still indistinguishable');
});

test('the structured record carries the attribution, not just the prose', async () => {
  // A host that draws the board instead of speaking it must be able to reach
  // this without parsing English.
  const aide = await openSession('aide-token');
  const david = await openSession('david-token');

  await call('aide-token', aide, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill', aboutMemberId: 'm_margaret',
  });

  const { eventId } = structured(await call('aide-token', aide, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'thyroid tablet', aboutMemberId: 'm_margaret',
  }));

  const data = structured(await call('david-token', david, 'get_care_summary'));
  // Match the dose this test logged. The scenario seeds first-hand doses of its
  // own, and picking the first entry tests those instead.
  const logged = (data.medications ?? []).find((m: any) => m.eventId === eventId);
  assert.ok(logged, 'no attribution in the structured content');
  assert.equal(logged.attribution.kind, 'REPORTED');
  assert.equal(logged.attribution.byMemberId, 'm_aide');
  assert.equal(logged.attribution.aboutMemberId, 'm_margaret');
});

test('a dose logged by the aide never becomes a care gap', async () => {
  // Doubting the aide is the same accusation from the other direction.
  const aide = await openSession('aide-token');
  const david = await openSession('david-token');

  await call('aide-token', aide, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill', aboutMemberId: 'm_margaret',
  });

  const gaps = structured(await call('david-token', david, 'get_care_gaps')).gaps ?? [];
  assert.equal(
    gaps.some((g: any) => /heart pill/i.test(g.spoken)),
    false,
    'the aide made a record and the system quietly disbelieved it',
  );
});

test('naming the reporter never becomes an accusation of anybody', async () => {
  const aide = await openSession('aide-token');
  const david = await openSession('david-token');

  await call('aide-token', aide, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill', aboutMemberId: 'm_margaret',
  });

  const said = spoken(await call('david-token', david, 'get_care_summary'));
  for (const accusation of [/did not/i, /didn't/i, /missed/i, /failed/i, /non-?compliant/i]) {
    assert.equal(accusation.test(said), false, `accusatory summary: ${said}`);
  }
});
