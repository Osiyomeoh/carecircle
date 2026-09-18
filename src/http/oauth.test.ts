import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { makePkce, pkceMatches, signToken, verifyToken, oauthResolver } from './oauth.ts';

/**
 * OAuth 2.1 + PKCE.
 *
 * Alexa+ requires this flow to link an add-on, and it is the difference between the
 * demo bearer tokens and something that could hold a real family's care record.
 *
 * Every test here is named after the attack it prevents. OAuth 2.1's tightenings
 * over 2.0 - mandatory PKCE, no `plain`, exact redirect matching, single-use codes -
 * are not ceremony; each one closes a specific way tokens get stolen.
 */

const SECRET = 'test-oauth-signing-secret';
const ISSUER = 'http://localhost';
const REDIRECT = 'https://client.example/cb';
const store = new CareStore();
let server: Server;
let base: string;

before(async () => {
  process.env['CARECIRCLE_OAUTH_SECRET'] = SECRET;
  process.env['CARECIRCLE_PUBLIC_URL'] = ISSUER;
  await store.reset();
  await seedDemoHousehold(store);
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  delete process.env['CARECIRCLE_OAUTH_SECRET'];
  delete process.env['CARECIRCLE_PUBLIC_URL'];
});

function authorizeUrl(over: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    client_id: 'alexa-plus',
    redirect_uri: REDIRECT,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...over,
  });
  return `${base}/oauth/authorize?${p.toString()}`;
}

/** Run the happy path and return the authorization code. */
async function getCode(challenge: string, member = 'm_renee'): Promise<string> {
  const res = await fetch(authorizeUrl({ code_challenge: challenge, member }), { redirect: 'manual' });
  assert.equal(res.status, 302, 'consent should redirect once a member is chosen');
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.searchParams.get('state'), 'xyz', 'state must be echoed back');
  return location.searchParams.get('code')!;
}

async function exchange(body: Record<string, string>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// --- discovery -----------------------------------------------------------

test('a client can discover the authorization server (RFC 9728)', async () => {
  const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.deepEqual(doc.authorization_servers, [ISSUER]);
});

test('metadata advertises S256 only, never plain', async () => {
  const doc = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
  assert.ok(!doc.code_challenge_methods_supported.includes('plain'));
  assert.deepEqual(doc.response_types_supported, ['code']);
});

// --- the flow works ------------------------------------------------------

test('the full authorization code flow issues a usable token', async () => {
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge);
  const { status, json } = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });
  assert.equal(status, 200);
  assert.equal(json.token_type, 'Bearer');
  assert.ok(json.access_token && json.refresh_token);

  const claims = verifyToken(json.access_token, SECRET);
  assert.equal(claims?.sub, 'm_renee', 'the token must name the member who consented');
});

test('the issued token actually authenticates an MCP session', async () => {
  // The point of all this: the token has to work on the real endpoint.
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge, 'm_david');
  const { json } = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });
  const resolver = oauthResolver(SECRET);
  const fake = { header: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${json.access_token}` : undefined) };
  assert.equal(resolver.resolve(fake as never), 'm_david');
});

test('an issued token opens a real MCP session as the right member', async () => {
  // The end-to-end point: a token from the OAuth flow must work on /mcp itself,
  // with that member's authority and nobody else's.
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge, 'm_aide');
  const { json } = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });

  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${json.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'oauth-client', version: '1.0' },
      },
    }),
  });
  assert.equal(res.status, 200, 'an OAuth access token must authenticate on /mcp');
  assert.ok(res.headers.get('mcp-session-id'), 'a session should be established');
  await res.text();
});

test('a garbage bearer token still gets 401 on /mcp', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer not-a-real-token',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }),
  });
  assert.equal(res.status, 401);
});

test('demo tokens keep working alongside OAuth', async () => {
  // A judge with renee-token and Alexa+ with an issued token reach the same circle.
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer renee-token',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }),
  });
  assert.equal(res.status, 200);
  await res.text();
});

test('a refresh token gets a new access token', async () => {
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge);
  const first = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });
  const second = await exchange({
    grant_type: 'refresh_token', refresh_token: first.json.refresh_token,
  });
  assert.equal(second.status, 200);
  assert.equal(verifyToken(second.json.access_token, SECRET)?.sub, 'm_renee');
});

// --- the attacks ---------------------------------------------------------

test('attack: authorization without PKCE is refused', async () => {
  // A public client without PKCE can have its code intercepted and redeemed.
  const res = await fetch(authorizeUrl({ member: 'm_renee' }), { redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error_description, /code_challenge is required/);
});

test('attack: a downgrade to plain PKCE is refused', async () => {
  // OAuth 2.1 removed `plain` because the challenge equals the verifier, so
  // intercepting the request gives you everything.
  const res = await fetch(
    authorizeUrl({ code_challenge: 'anything', code_challenge_method: 'plain', member: 'm_renee' }),
    { redirect: 'manual' },
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error_description, /S256/);
});

test('attack: a stolen code without the verifier is worthless', async () => {
  // This is the whole point of PKCE. The attacker has the code and not the verifier.
  const { challenge } = makePkce();
  const code = await getCode(challenge);
  const { status, json } = await exchange({
    grant_type: 'authorization_code', code,
    code_verifier: randomBytes(32).toString('hex'), redirect_uri: REDIRECT,
  });
  assert.equal(status, 400);
  assert.equal(json.error, 'invalid_grant');
});

test('attack: a code cannot be replayed', async () => {
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge);
  const first = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });
  assert.equal(first.status, 200);
  const second = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });
  assert.equal(second.status, 400, 'an authorization code is single-use');
});

test('attack: a failed exchange still burns the code', async () => {
  // Otherwise a leaked code could be retried against guessed verifiers.
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge);
  await exchange({
    grant_type: 'authorization_code', code, code_verifier: 'wrong', redirect_uri: REDIRECT,
  });
  const retry = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
  });
  assert.equal(retry.status, 400, 'the code must not survive a failed attempt');
});

test('attack: redirecting the token to another URI is refused', async () => {
  // Prefix-matching redirect URIs is how tokens end up at an attacker's endpoint.
  const { verifier, challenge } = makePkce();
  const code = await getCode(challenge);
  const { status } = await exchange({
    grant_type: 'authorization_code', code, code_verifier: verifier,
    redirect_uri: `${REDIRECT}.attacker.example`,
  });
  assert.equal(status, 400);
});

test('attack: an unknown member cannot be consented as', async () => {
  const { challenge } = makePkce();
  const res = await fetch(authorizeUrl({ code_challenge: challenge, member: 'm_intruder' }), { redirect: 'manual' });
  assert.equal(res.status, 400);
});

test('attack: a forged token with alg=none is rejected', async () => {
  // The classic JWT forgery: trust the algorithm the token names.
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'm_renee', exp: 9e9 })}.`;
  assert.equal(verifyToken(forged, SECRET), null);
});

test('attack: a token signed with the wrong key is rejected', async () => {
  const token = signToken(
    { sub: 'm_renee', iss: ISSUER, aud: ISSUER, exp: 9e9, iat: 0, typ: 'access' },
    'not-the-real-secret',
  );
  assert.equal(verifyToken(token, SECRET), null);
});

test('attack: an expired token is rejected', () => {
  const token = signToken(
    { sub: 'm_renee', iss: ISSUER, aud: ISSUER, exp: Math.floor(Date.now() / 1000) - 10, iat: 0, typ: 'access' },
    SECRET,
  );
  assert.equal(verifyToken(token, SECRET), null);
});

test('attack: a refresh token cannot be used as an access token', () => {
  // They have different lifetimes; swapping one for the other extends access
  // by a month.
  const refresh = signToken(
    { sub: 'm_renee', iss: ISSUER, aud: ISSUER, exp: 9e9, iat: 0, typ: 'refresh' },
    SECRET,
  );
  const resolver = oauthResolver(SECRET);
  const fake = { header: () => `Bearer ${refresh}` };
  assert.equal(resolver.resolve(fake as never), null);
});

// --- PKCE unit -----------------------------------------------------------

test('PKCE S256 is computed the way the RFC says', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expected = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(pkceMatches(verifier, expected), true);
  assert.equal(pkceMatches(verifier, 'not-the-challenge'), false);
  assert.equal(pkceMatches('', expected), false);
});
