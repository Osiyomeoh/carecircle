import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jwtClaims, staticTokens, resolverFromEnv } from './identity.ts';
import type { Request } from 'express';

const req = (authorization?: string) =>
  ({ header: (n: string) => (n.toLowerCase() === 'authorization' ? authorization : undefined) }) as Request;

const jwt = (claims: Record<string, unknown>) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.signature`;
};

test('static tokens resolve a member, and anything else resolves to nobody', () => {
  const r = staticTokens(new Map([['david-token', 'm_david']]));
  assert.equal(r.resolve(req('Bearer david-token')), 'm_david');
  assert.equal(r.resolve(req('Bearer wrong')), null);
  assert.equal(r.resolve(req()), null);
  assert.equal(r.resolve(req('david-token')), null, 'must require the Bearer scheme');
});

test('a jwt subject resolves to the member it is mapped to', () => {
  const r = jwtClaims({ claim: 'sub', members: new Map([['cognito-uuid-1', 'm_renee']]) });
  assert.equal(r.resolve(req(`Bearer ${jwt({ sub: 'cognito-uuid-1' })}`)), 'm_renee');
});

test('an authenticated stranger is not a member of the care circle', () => {
  // Being authenticated is not the same as belonging to this family.
  const r = jwtClaims({ claim: 'sub', members: new Map([['known', 'm_renee']]) });
  assert.equal(r.resolve(req(`Bearer ${jwt({ sub: 'someone-else' })}`)), null);
});

test('an expired token is not honoured even behind a validating gateway', () => {
  const r = jwtClaims({ claim: 'sub', members: new Map([['known', 'm_renee']]) });
  const expired = jwt({ sub: 'known', exp: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(r.resolve(req(`Bearer ${expired}`)), null);
  const valid = jwt({ sub: 'known', exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(r.resolve(req(`Bearer ${valid}`)), 'm_renee');
});

test('malformed tokens resolve to nobody rather than throwing', () => {
  const r = jwtClaims({ claim: 'sub', members: new Map([['known', 'm_renee']]) });
  for (const bad of ['Bearer not-a-jwt', 'Bearer a.b', 'Bearer a.!!!.c', 'Bearer ..']) {
    assert.equal(r.resolve(req(bad)), null, `should not admit ${bad}`);
  }
});

test('a custom claim can carry the member identity', () => {
  const r = jwtClaims({
    claim: 'custom:carecircle_member',
    members: new Map([['margaret@example.com', 'm_margaret']]),
  });
  assert.equal(
    r.resolve(req(`Bearer ${jwt({ sub: 'x', 'custom:carecircle_member': 'margaret@example.com' })}`)),
    'm_margaret',
  );
});

test('the JWT strategy is opt-in, never inferred', () => {
  // Enabling it on a directly exposed server would let anyone assert any identity,
  // so it must require an explicit signal rather than defaulting on.
  const previous = process.env['CARECIRCLE_JWT_CLAIM'];
  delete process.env['CARECIRCLE_JWT_CLAIM'];
  assert.equal(resolverFromEnv(new Map([['t', 'm_david']])).strategy, 'static');
  if (previous !== undefined) process.env['CARECIRCLE_JWT_CLAIM'] = previous;
});

test('refuses to start with an identity map nobody could authenticate against', () => {
  const previousClaim = process.env['CARECIRCLE_JWT_CLAIM'];
  const previousMap = process.env['CARECIRCLE_MEMBER_MAP'];
  process.env['CARECIRCLE_JWT_CLAIM'] = 'sub';

  process.env['CARECIRCLE_MEMBER_MAP'] = '{}';
  assert.throws(() => resolverFromEnv(new Map()), /nobody could authenticate/);

  process.env['CARECIRCLE_MEMBER_MAP'] = 'not json';
  assert.throws(() => resolverFromEnv(new Map()), /not valid JSON/);

  if (previousClaim === undefined) delete process.env['CARECIRCLE_JWT_CLAIM'];
  else process.env['CARECIRCLE_JWT_CLAIM'] = previousClaim;
  if (previousMap === undefined) delete process.env['CARECIRCLE_MEMBER_MAP'];
  else process.env['CARECIRCLE_MEMBER_MAP'] = previousMap;
});
