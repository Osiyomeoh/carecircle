import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from '../../http/app.ts';
import { CareStore } from '../../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../../demo/seed.ts';
import { seedScenario } from '../../demo/scenario.ts';
import { CARE_BOARD_HTML } from './care-board.ts';
import { APP_MIME_TYPE, LEGACY_RESOURCE_URI_KEY } from './protocol.ts';

/**
 * The Care Board, checked over the wire.
 *
 * The view is an *optional* enhancement, so the tests that matter most are the
 * ones about what happens without it: the spoken answer must stay complete on a
 * host that cannot draw anything. The rest assert the bits of the extension a
 * host actually reads, because getting a metadata key wrong fails silently - the
 * tool still works and the board simply never appears.
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
      const address = server.address();
      base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}/mcp`;
      resolve();
    });
  });
});

after(() => { server?.close(); });

const HEADERS = (token: string, sessionId?: string) => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${token}`,
  ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
});

async function openSession(token: string): Promise<string> {
  const res = await fetch(base, {
    method: 'POST',
    headers: HEADERS(token),
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        // A host that renders MCP Apps advertises it here.
        capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [APP_MIME_TYPE] } } },
        clientInfo: { name: 'app-host', version: '1.0' },
      },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id');
  await res.text();
  assert.ok(sessionId, 'expected a session id');
  await fetch(base, {
    method: 'POST', headers: HEADERS(token, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return sessionId;
}

async function rpc(
  token: string, sessionId: string, method: string, params: Record<string, unknown> = {},
): Promise<any> {
  const res = await fetch(base, {
    method: 'POST', headers: HEADERS(token, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params }),
  });
  const text = await res.text();
  // Streamable HTTP may answer as SSE; take the one data frame either way.
  const json = text.startsWith('event:') || text.startsWith('data:')
    ? text.split('\n').find((l) => l.startsWith('data:'))!.slice(5).trim()
    : text;
  return JSON.parse(json);
}

// --- the host-visible contract -------------------------------------------

test('get_care_gaps points at the care board in both metadata formats', async () => {
  const session = await openSession('renee-token');
  const { result } = await rpc('renee-token', session, 'tools/list');
  const tool = result.tools.find((t: any) => t.name === 'get_care_gaps');

  assert.ok(tool, 'get_care_gaps should be listed');
  // The extension moved the key; hosts in the wild read one or the other, so a
  // regression here means the board silently stops appearing on half of them.
  assert.equal(tool._meta?.ui?.resourceUri, 'ui://carecircle/care-board.html');
  assert.equal(tool._meta?.[LEGACY_RESOURCE_URI_KEY], 'ui://carecircle/care-board.html');
});

test('the care board is readable as an app resource', async () => {
  const session = await openSession('renee-token');
  const listed = await rpc('renee-token', session, 'resources/list');
  const entry = listed.result.resources.find((r: any) => r.uri === 'ui://carecircle/care-board.html');
  assert.ok(entry, 'the ui:// resource should be listed');
  assert.equal(entry.mimeType, APP_MIME_TYPE);

  const read = await rpc('renee-token', session, 'resources/read', {
    uri: 'ui://carecircle/care-board.html',
  });
  const content = read.result.contents[0];
  assert.equal(content.mimeType, APP_MIME_TYPE);
  assert.match(content.text, /<!doctype html>/i);
});

test('the board carries the arithmetic behind each ranking', async () => {
  const session = await openSession('renee-token');
  const { result } = await rpc('renee-token', session, 'tools/call', {
    name: 'get_care_gaps', arguments: {},
  });
  const gaps = result.structuredContent.gaps;
  assert.ok(gaps.length > 0, 'the seeded scenario should have gaps');

  for (const gap of gaps) {
    // Without these the view cannot show *why* a gap ranks where it does, and
    // an unauditable ranking over someone's medical care is the thing we set
    // out not to build.
    assert.equal(typeof gap.factors?.cost, 'number', `${gap.id} should carry cost`);
    assert.equal(typeof gap.factors?.pDrop, 'number', `${gap.id} should carry pDrop`);
    assert.equal(typeof gap.factors?.confidence, 'number', `${gap.id} should carry confidence`);
  }
});

test('the spoken answer stays complete without the view', async () => {
  const session = await openSession('renee-token');
  const { result } = await rpc('renee-token', session, 'tools/call', {
    name: 'get_care_gaps', arguments: {},
  });
  // A voice surface gets no iframe. If the view ever became load-bearing, this
  // is where it would show up - as an answer that only makes sense on a screen.
  const text = result.content?.[0]?.text ?? '';
  assert.ok(text.length > 0, 'there should still be something to say');
  assert.doesNotMatch(text, /\bbelow\b|\bon (the )?screen\b|\btap\b|\bclick\b/i);
});

// --- the document itself --------------------------------------------------

test('the view reaches no origin but its host', () => {
  // The board renders a family's medical coordination. It is served inline into
  // a sandboxed iframe, so anything it pulled from a third party would be a
  // remote-code path into that view - and would need a CSP allowlist we would
  // then have to justify. Keeping it self-contained means there is nothing to
  // allowlist and nothing to inject.
  assert.doesNotMatch(CARE_BOARD_HTML, /<script[^>]+src=/i, 'no external scripts');
  assert.doesNotMatch(CARE_BOARD_HTML, /<link[^>]+href=/i, 'no external stylesheets');
  assert.doesNotMatch(CARE_BOARD_HTML, /https?:\/\//i, 'no absolute URLs at all');
});

test('the view never renders an absent record as an accusation', () => {
  // The whole trust model in one assertion: a gap of kind UNCONFIRMED means we
  // have no record, which is not evidence that something did not happen.
  assert.match(CARE_BOARD_HTML, /No record/);
  assert.doesNotMatch(CARE_BOARD_HTML, /\bmissed\b|\bfailed to\b|\bdid ?n[o']?t take\b/i);
});

test('the view only calls tools the server actually exposes', async () => {
  const session = await openSession('renee-token');
  const { result } = await rpc('renee-token', session, 'tools/list');
  const names: string[] = result.tools.map((t: any) => t.name);

  // The view names its tools as string literals, so a rename on the server would
  // otherwise only surface as a dead button in someone's hands.
  const called = [...CARE_BOARD_HTML.matchAll(/callTool\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 2, 'expected the view to call tools');
  for (const name of called) {
    assert.ok(names.includes(name), `the view calls "${name}", which the server does not expose`);
  }
});
