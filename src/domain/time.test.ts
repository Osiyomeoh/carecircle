import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOffset, implausible, toInstant } from './time.ts';

const NY = 'America/New_York';

test('a wall-clock time is read in the household zone, not UTC', () => {
  // 10am in New York in September is 14:00 UTC (EDT, -4).
  assert.equal(toInstant('2026-09-24T10:00:00', NY), '2026-09-24T14:00:00.000Z');
});

test('a timestamp that already carries an offset is left alone', () => {
  assert.equal(toInstant('2026-09-24T14:00:00Z', NY), '2026-09-24T14:00:00.000Z');
  assert.equal(toInstant('2026-09-24T10:00:00-04:00', NY), '2026-09-24T14:00:00.000Z');
});

test('winter and summer offsets are both handled', () => {
  // January is EST (-5), so 10am local is 15:00 UTC.
  assert.equal(toInstant('2027-01-14T10:00:00', NY), '2027-01-14T15:00:00.000Z');
});

test('offsets are detected, so we know when we are guessing', () => {
  assert.equal(hasOffset('2026-09-24T14:00:00Z'), true);
  assert.equal(hasOffset('2026-09-24T10:00:00-04:00'), true);
  assert.equal(hasOffset('2026-09-24T10:00:00'), false);
});

test('gibberish becomes null rather than an Invalid Date', () => {
  assert.equal(toInstant('next thursday', NY), null);
  assert.equal(toInstant('', NY), null);
});

// --- catching an invented date -------------------------------------------

const NOW = new Date('2026-09-18T12:00:00Z');

test('the date a planner actually invented is refused', () => {
  // This is the real one: recorded on 2026-09-18, dated 2024-12-19.
  const bad = implausible('2024-12-19T14:00:00Z', NOW);
  assert.equal(bad?.reason, 'too-far-past');
  assert.match(bad!.spoken, /Which day did you mean\?/);
});

test('an ordinary upcoming appointment is accepted', () => {
  assert.equal(implausible('2026-09-24T14:00:00Z', NOW), null);
});

test('recording something a day late is still fine', () => {
  assert.equal(implausible('2026-09-17T14:00:00Z', NOW), null);
});

test('a date years out is questioned too', () => {
  assert.equal(implausible('2028-01-01T00:00:00Z', NOW)?.reason, 'too-far-future');
});
