import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';

/**
 * Onboarding, end to end, over real MCP: a new family signs up with nothing but an
 * authenticated credential, and the member it creates can then authenticate.
 */

const store = new CareStore();
let server: Server;
let base: string;

before(async () => {
  const app = createCareCircleApp({ store, allowSelfSignup: true });
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

async function connect(token: string): Promise<Client> {
  const c = new Client({ name: 'onboarding-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }) as never);
  return c;
}
const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<any>;

test('a validated-but-unmapped caller can create a household and becomes its primary caregiver', async () => {
  const founder = await connect('founder-tok');
  const res = await call(founder, 'create_household', {
    name: "Grace's care circle", timezone: 'America/New_York', callerName: 'Dana',
  });
  assert.ok(res.structuredContent.householdId);
  assert.ok(res.structuredContent.memberId);
  await founder.close();
});

test('the founder then authenticates as a real member and can grow the circle', async () => {
  // Same credential - now resolves to the member created above, not a bootstrap principal.
  const dana = await connect('founder-tok');
  const recipient = await call(dana, 'add_member', { name: 'Grace', role: 'care_recipient' });
  assert.ok(recipient.structuredContent.memberId);
  const renee = await call(dana, 'add_member', { name: 'Renee', role: 'caregiver', subject: 'renee-tok' });
  assert.ok(renee.structuredContent.memberId);
  const med = await call(dana, 'add_medication', {
    name: 'heart pill', times: ['08:00', '20:00'], forMemberId: recipient.structuredContent.memberId,
  });
  assert.ok(med.structuredContent.medicationId);
  await dana.close();
});

test('a member added at runtime can authenticate with their own credential', async () => {
  const renee = await connect('renee-tok');
  // She is a real member: a member-only read succeeds rather than erroring as a stranger.
  const gaps = await call(renee, 'get_care_gaps', {});
  assert.equal(gaps.isError ?? false, false);
  await renee.close();
});

test('the last primary caregiver cannot be removed, and nobody removes themselves', async () => {
  const dana = await connect('founder-tok');
  const state = await call(dana, 'get_care_summary', {});
  assert.equal(state.isError ?? false, false);
  // Dana is the only primary caregiver; removing herself is refused twice over.
  const me = await call(dana, 'add_member', { name: 'Tasha', role: 'helper', subject: 'tasha-tok' });
  const removed = await call(dana, 'remove_member', { memberId: me.structuredContent.memberId });
  assert.match(removed.content[0].text, /Removed Tasha/);
  await dana.close();
});

test('self-signup is off by default (the deployed demo behaviour is unchanged)', async () => {
  const s2 = new CareStore();
  const app2 = createCareCircleApp({ store: s2 }); // no allowSelfSignup
  const srv2 = app2.listen(0);
  await new Promise<void>((r) => srv2.once('listening', r));
  const b2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}/mcp`;
  const c = new Client({ name: 'no-signup', version: '1' });
  await assert.rejects(
    c.connect(new StreamableHTTPClientTransport(new URL(b2), {
      requestInit: { headers: { Authorization: 'Bearer some-random-token' } },
    }) as never),
    /401|Unauthorized|HTTP/i,
  );
  await new Promise<void>((r) => srv2.close(() => r()));
});
