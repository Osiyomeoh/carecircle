import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCareGaps, pendingProposals } from './gaps.ts';
import type { CareState, Obligation } from './types.ts';

/** Thursday 2026-10-15, 14:00 in New York. */
const NOW = new Date('2026-10-15T18:00:00Z');

function baseState(over: Partial<CareState> = {}): CareState {
  return {
    household: { id: 'h1', name: "Margaret's circle", timezone: 'America/New_York' },
    members: [
      { id: 'm_margaret', householdId: 'h1', name: 'Margaret', role: 'care_recipient', spokenAs: 'Mom' },
      { id: 'm_david', householdId: 'h1', name: 'David', role: 'primary_caregiver' },
      { id: 'm_renee', householdId: 'h1', name: 'Renee', role: 'caregiver' },
    ],
    events: [],
    obligations: [],
    medications: [],
    ...over,
  };
}

function obligation(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1',
    householdId: 'h1',
    what: 'Drive Margaret to cardiology',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-10-13T12:00:00Z' },
    ownerId: null,
    createdAt: '2026-10-13T12:00:00Z',
    ...over,
  };
}

test('an unowned obligation becomes an UNCLAIMED care gap', () => {
  const gaps = detectCareGaps(
    baseState({ obligations: [obligation({ dueAt: '2026-10-16T14:00:00Z' })] }),
    { now: NOW },
  );
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.kind, 'UNCLAIMED');
  assert.match(gaps[0]!.spoken, /nobody has taken this yet/);
});

test('an owned obligation produces no gap', () => {
  const gaps = detectCareGaps(
    baseState({
      obligations: [obligation({ status: 'ASSIGNED', ownerId: 'm_david', dueAt: '2026-10-16T14:00:00Z' })],
    }),
    { now: NOW },
  );
  assert.deepEqual(gaps, []);
});

test('PROPOSED obligations are never reported as care gaps', () => {
  // The trust model in reverse: the system must not present its own guess as work.
  const state = baseState({
    obligations: [obligation({
      status: 'PROPOSED',
      provenance: { kind: 'INFERRED', rule: 'medical-appointment-transport', from: 'cardiology appointment' },
    })],
  });
  assert.deepEqual(detectCareGaps(state, { now: NOW }), []);
  assert.equal(pendingProposals(state).length, 1);
});

test('a missing dose is reported as missing, never as not taken', () => {
  const gaps = detectCareGaps(
    baseState({
      medications: [{ id: 'med1', householdId: 'h1', name: 'heart pill', times: ['08:00'], forMemberId: 'm_margaret' }],
    }),
    { now: NOW },
  );
  assert.equal(gaps.length, 1);
  const g = gaps[0]!;
  assert.equal(g.kind, 'UNCONFIRMED');
  assert.match(g.spoken, /no record of Mom's heart pill/);
  // The hard rule of the project, asserted directly.
  assert.doesNotMatch(g.spoken, /did ?n[o']t take|missed|forgot|failed/i);
  assert.match(g.because, /not that it was missed/);
});

test('a logged dose clears the unconfirmed gap', () => {
  const gaps = detectCareGaps(
    baseState({
      medications: [{ id: 'med1', householdId: 'h1', name: 'heart pill', times: ['08:00'], forMemberId: 'm_margaret' }],
      events: [{
        id: 'e1', householdId: 'h1', kind: 'medication_taken', reportedBy: 'm_margaret',
        occurredAt: '2026-10-15T12:10:00Z', // 08:10 New York
        recordedAt: '2026-10-15T12:10:00Z', data: { medicationId: 'med1' },
      }],
    }),
    { now: NOW },
  );
  assert.deepEqual(gaps, []);
});

test('a dose is not flagged before its time plus grace period', () => {
  const gaps = detectCareGaps(
    baseState({
      medications: [{ id: 'med1', householdId: 'h1', name: 'evening pill', times: ['20:00'], forMemberId: 'm_margaret' }],
    }),
    { now: NOW }, // 14:00 local - the evening dose is not due yet
  );
  assert.deepEqual(gaps, []);
});

test('medical work outranks social work of the same urgency', () => {
  const gaps = detectCareGaps(
    baseState({
      obligations: [
        obligation({ id: 'o_social', what: 'Call Mom for her birthday', consequence: 'social', dueAt: '2026-10-16T14:00:00Z' }),
        obligation({ id: 'o_med', what: 'Drive Margaret to cardiology', consequence: 'medical', dueAt: '2026-10-16T14:00:00Z' }),
      ],
    }),
    { now: NOW },
  );
  assert.equal(gaps[0]!.obligationId, 'o_med');
  assert.equal(gaps[1]!.obligationId, 'o_social');
});

test('assigned work past its due time needs follow-up', () => {
  const gaps = detectCareGaps(
    baseState({
      obligations: [obligation({
        what: 'Pick up prescription', status: 'ASSIGNED', ownerId: 'm_renee',
        consequence: 'logistical', dueAt: '2026-10-14T14:00:00Z',
      })],
    }),
    { now: NOW },
  );
  assert.equal(gaps[0]!.kind, 'NEEDS_FOLLOW_UP');
  assert.match(gaps[0]!.spoken, /hasn't been marked done/);
});

test('withinDays filters dated gaps but keeps undated ones', () => {
  const state = baseState({
    obligations: [
      obligation({ id: 'o_far', dueAt: '2026-11-30T14:00:00Z' }),
      obligation({ id: 'o_undated' }),
    ],
  });
  const ids = detectCareGaps(state, { now: NOW, withinDays: 7 }).map((g) => g.obligationId);
  assert.deepEqual(ids, ['o_undated']);
});

test('gap detection is deterministic for a fixed now', () => {
  const state = baseState({
    obligations: [obligation({ dueAt: '2026-10-16T14:00:00Z' })],
    medications: [{ id: 'med1', householdId: 'h1', name: 'heart pill', times: ['08:00'], forMemberId: 'm_margaret' }],
  });
  assert.deepEqual(detectCareGaps(state, { now: NOW }), detectCareGaps(state, { now: NOW }));
});
