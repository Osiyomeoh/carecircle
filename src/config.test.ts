import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

const base = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...over });

test('defaults to file persistence, static identity, demo seeded', () => {
  const c = loadConfig(base());
  assert.equal(c.persistence, 'file');
  assert.equal(c.identity, 'static');
  assert.equal(c.seedDemo, true);
  assert.equal(c.port, 8787);
});

test('a DynamoDB table with no region is refused', () => {
  assert.throws(() => loadConfig(base({ CARECIRCLE_TABLE: 'care' })), /AWS_REGION/);
});

test('a DynamoDB table with a region selects dynamodb', () => {
  const c = loadConfig(base({ CARECIRCLE_TABLE: 'care', AWS_REGION: 'us-east-1' }));
  assert.equal(c.persistence, 'dynamodb');
  assert.equal(c.tableName, 'care');
  assert.equal(c.region, 'us-east-1');
});

test('JWT identity never seeds demo data, even if asked', () => {
  const c = loadConfig(base({ CARECIRCLE_JWT_CLAIM: 'sub' }));
  assert.equal(c.identity, 'jwt');
  assert.equal(c.seedDemo, false);
});

test('demanding demo seed under JWT identity is refused, not silently ignored', () => {
  assert.throws(
    () => loadConfig(base({ CARECIRCLE_JWT_CLAIM: 'sub', CARECIRCLE_SEED_DEMO: 'true' })),
    /refusing to seed demo data/,
  );
});

test('demo seed can be turned off on a static box', () => {
  const c = loadConfig(base({ CARECIRCLE_SEED_DEMO: 'false' }));
  assert.equal(c.seedDemo, false);
});

test('a non-numeric port is refused', () => {
  assert.throws(() => loadConfig(base({ PORT: 'eighty' })), /PORT/);
});

test('an out-of-range port is refused', () => {
  assert.throws(() => loadConfig(base({ PORT: '70000' })), /PORT/);
});

test('a malformed boolean is refused', () => {
  assert.throws(() => loadConfig(base({ CARECIRCLE_SEED_DEMO: 'yes' })), /boolean/);
});
