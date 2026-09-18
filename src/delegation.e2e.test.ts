import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './http/app.ts';
import { CareStore } from './store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from './demo/seed.ts';
import { seedScenario } from './demo/scenario.ts';

/**
 * The delegation loop, end to end over the real MCP wire.
 *
 * DETECT -> ASK -> DECLINE -> ASK NEXT -> ACCEPT -> OWNED.
 *
 * The domain tests prove the arithmetic; these prove the protocol actually moves
 * responsibility the way the product claims, including who is allowed to answer.
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

// Each test gets the scenario back exactly as it was: the loop MOVES ownership,
// so a test that runs second would otherwise find the work already taken.
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
        clientInfo: { name: 'loop', version: '1.0' },
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

/** The unowned cardiology ride the scenario seeds. */
async function theRide(token: string, session: string): Promise<string> {
  const gaps = structured(await call(token, session, 'get_care_gaps')).gaps ?? [];
  const ride = gaps.find((g: any) => /cardiology/i.test(g.spoken) && g.obligationId);
  assert.ok(ride, 'expected an unowned cardiology ride in the seeded scenario');
  return ride.obligationId;
}

test('the whole loop: ask, decline, ask the next person, accept', async () => {
  const renee = await openSession('renee-token');
  const david = await openSession('david-token');
  const id = await theRide('renee-token', renee);

  // ASK. Renee asks David.
  const asked = await call('renee-token', renee, 'request_owner',
    { obligationId: id, assigneeName: 'David' });
  assert.match(spoken(asked), /asked David/i);
  assert.match(spoken(asked), /stays unowned/i);
  assert.equal(structured(asked).status, 'REQUESTED');

  // It is STILL a care gap. Being asked is not being assigned.
  const midGaps = structured(await call('renee-token', renee, 'get_care_gaps')).gaps;
  const still = midGaps.find((g: any) => g.obligationId === id);
  assert.ok(still, 'a pending request must remain a care gap');
  assert.match(still.spoken, /hasn't answered yet/i);

  // David sees it as his to answer.
  const mine = await call('david-token', david, 'get_my_requests');
  assert.equal(structured(mine).requests.length, 1);
  assert.equal(structured(mine).requests[0].obligationId, id);

  // DECLINE. It goes back to unowned, and the loop proposes the next person.
  const declined = await call('david-token', david, 'respond_to_request',
    { obligationId: id, accepted: false, note: "I'm away Thursday" });
  assert.equal(structured(declined).declined, true);
  assert.match(spoken(declined), /no owner/i);
  assert.ok(structured(declined).nextCandidate, 'a decline should offer somebody next');

  // David is not asked again.
  const reAsk = await call('renee-token', renee, 'request_owner',
    { obligationId: id, assigneeName: 'David' });
  assert.match(spoken(reAsk), /already said no/i);

  // ACCEPT. Renee asks herself? No - she claims. Ask Tasha, who accepts.
  await call('renee-token', renee, 'request_owner', { obligationId: id, assigneeName: 'Tasha' });
  const aide = await openSession('aide-token');
  const accepted = await call('aide-token', aide, 'respond_to_request',
    { obligationId: id, accepted: true });
  assert.equal(structured(accepted).status, 'ASSIGNED');
  assert.match(spoken(accepted), /yours now/i);

  // And now it is genuinely owned: no longer a gap.
  const after = structured(await call('renee-token', renee, 'get_care_gaps')).gaps;
  assert.ok(!after.some((g: any) => g.obligationId === id),
    'an accepted request should stop being a care gap');
});

test('only the person asked can answer for themselves', async () => {
  const renee = await openSession('renee-token');
  const david = await openSession('david-token');
  const id = await theRide('renee-token', renee);

  await call('renee-token', renee, 'request_owner', { obligationId: id, assigneeName: 'Tasha' });
  // David tries to accept on Tasha's behalf. The system must not invent an
  // agreement that was never given.
  const stolen = await call('david-token', david, 'respond_to_request',
    { obligationId: id, accepted: true });
  assert.match(spoken(stolen), /theirs to answer/i);

  const state = structured(await call('renee-token', renee, 'get_care_gaps')).gaps;
  assert.ok(state.some((g: any) => g.obligationId === id),
    'it must still be an open gap after a rejected answer');
});

test('the person being cared for can ask for help herself', async () => {
  // Margaret is a participant, not a subject. She cannot assign, but she can ask.
  const renee = await openSession('renee-token');
  const id = await theRide('renee-token', renee);
  const margaret = await openSession('margaret-token');

  const asked = await call('margaret-token', margaret, 'request_owner',
    { obligationId: id, assigneeName: 'David' });
  assert.match(spoken(asked), /asked David/i);

  // But assigning is still beyond her.
  const assign = await call('margaret-token', margaret, 'assign_obligation',
    { obligationId: id, assigneeName: 'David' });
  assert.match(spoken(assign), /primary caregiver/i);
});

test('with no name given, CareCircle picks someone and says why', async () => {
  const renee = await openSession('renee-token');
  const id = await theRide('renee-token', renee);
  const asked = await call('renee-token', renee, 'request_owner', { obligationId: id });
  assert.match(spoken(asked), /I picked \w+ because they're the one who has/i);
  assert.ok(structured(asked).askedOfId, 'it should have chosen somebody');
});
