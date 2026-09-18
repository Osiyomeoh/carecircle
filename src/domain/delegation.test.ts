import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, loadOf, statedUnavailable } from './delegation.ts';
import { detectCareGaps } from './gaps.ts';
import type { CareEvent, CareState, Obligation } from './types.ts';

const NOW = new Date('2026-10-15T18:00:00Z');

function baseState(over: Partial<CareState> = {}): CareState {
  return {
    household: { id: 'h1', name: "Margaret's circle", timezone: 'America/New_York' },
    members: [
      { id: 'm_margaret', householdId: 'h1', name: 'Margaret', role: 'care_recipient', spokenAs: 'Mom' },
      { id: 'm_david', householdId: 'h1', name: 'David', role: 'primary_caregiver' },
      { id: 'm_renee', householdId: 'h1', name: 'Renee', role: 'caregiver' },
      { id: 'm_tasha', householdId: 'h1', name: 'Tasha', role: 'helper' },
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
    dueAt: '2026-10-16T14:00:00Z',
    ...over,
  };
}

function unavailabilityEvent(memberName: string, from: string, to: string): CareEvent {
  return {
    id: 'e_unavail', householdId: 'h1', kind: 'note_added', reportedBy: 'm_david',
    occurredAt: '2026-10-14T12:00:00Z', recordedAt: '2026-10-14T12:00:00Z',
    data: { unavailable: { memberName, from, to } },
  };
}

test('the person being cared for is never a candidate to drive herself', () => {
  const names = candidatesFor(obligation(), baseState()).map((c) => c.name);
  assert.ok(!names.includes('Mom'));
});

test('whoever is asking is not offered as the answer', () => {
  const names = candidatesFor(obligation(), baseState(), { askerId: 'm_david' })
    .map((c) => c.name);
  assert.ok(!names.includes('David'));
  assert.ok(names.includes('Renee'));
});

test('the person carrying least ranks first', () => {
  // The failure mode families actually have is everything landing on whoever
  // answers fastest. Load comes before role for exactly that reason.
  const state = baseState({
    obligations: [
      obligation(),
      obligation({ id: 'o2', status: 'ASSIGNED', ownerId: 'm_david' }),
      obligation({ id: 'o3', status: 'ASSIGNED', ownerId: 'm_david' }),
      obligation({ id: 'o4', status: 'ASSIGNED', ownerId: 'm_renee' }),
    ],
  });
  const ranked = candidatesFor(obligation(), state);
  assert.equal(ranked[0]!.name, 'Renee');
  assert.equal(ranked[0]!.load, 1);
  assert.equal(loadOf('m_david', state), 2);
});

test('the paid aide is asked only after the family has run out', () => {
  // Tasha starts every week empty, so ranking on load alone would hand her the
  // cardiology drive ahead of both of Margaret's children.
  const busyFamily = baseState({
    obligations: [
      obligation({ id: 'o2', status: 'ASSIGNED', ownerId: 'm_david' }),
      obligation({ id: 'o3', status: 'ASSIGNED', ownerId: 'm_renee' }),
    ],
  });
  const ranked = candidatesFor(obligation(), busyFamily);
  assert.equal(ranked.at(-1)!.name, 'Tasha');
  assert.equal(loadOf('m_tasha', busyFamily), 0);

  // But she is still there when nobody else is left.
  const onlyTasha = candidatesFor(
    obligation({ declinedBy: ['m_david', 'm_renee'] }), busyFamily,
  );
  assert.equal(onlyTasha[0]!.name, 'Tasha');
});

test('somebody who already said no is not asked again', () => {
  const ranked = candidatesFor(
    obligation({ declinedBy: ['m_david', 'm_renee'] }), baseState(),
  );
  const names = ranked.map((c) => c.name);
  assert.ok(!names.includes('David'));
  assert.ok(!names.includes('Renee'));
  assert.ok(names.includes('Tasha'));
});

test('a stated conflict at the due time takes someone out of the running', () => {
  const state = baseState({
    events: [unavailabilityEvent('David', '2026-10-16T12:00:00Z', '2026-10-16T20:00:00Z')],
  });
  assert.equal(statedUnavailable(state.members[1]!, state, '2026-10-16T14:00:00Z'), true);
  assert.ok(!candidatesFor(obligation(), state).map((c) => c.name).includes('David'));
});

test('a conflict at a different time leaves them eligible', () => {
  // Not knowing someone's plans is not evidence they are busy.
  const state = baseState({
    events: [unavailabilityEvent('David', '2026-10-20T12:00:00Z', '2026-10-20T20:00:00Z')],
  });
  assert.ok(candidatesFor(obligation(), state).map((c) => c.name).includes('David'));
});

test('an alias is matched, so "Mom said David is away" still counts', () => {
  const state = baseState({
    events: [unavailabilityEvent('david', '2026-10-16T12:00:00Z', '2026-10-16T20:00:00Z')],
  });
  assert.ok(!candidatesFor(obligation(), state).map((c) => c.name).includes('David'));
});

test('running out of people is said plainly rather than crashing', () => {
  const ranked = candidatesFor(
    obligation({ declinedBy: ['m_david', 'm_renee', 'm_tasha'] }), baseState(),
  );
  assert.deepEqual(ranked, []);
});

test('every candidate carries a reason that can be spoken aloud', () => {
  for (const c of candidatesFor(obligation(), baseState())) {
    assert.match(c.because, /^has /);
    assert.ok(!/undefined|null|NaN/.test(c.because));
  }
});

// --- the loop's central promise ------------------------------------------

test('being asked is not being assigned: it is still a care gap', () => {
  const gaps = detectCareGaps(baseState({
    obligations: [obligation({
      status: 'REQUESTED', ownerId: null,
      request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt: '2026-10-15T17:00:00Z' },
    })],
  }), { now: NOW });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.kind, 'UNCLAIMED');
});

test('an unanswered request is spoken as asked, never as agreed', () => {
  const gaps = detectCareGaps(baseState({
    obligations: [obligation({
      status: 'REQUESTED', ownerId: null,
      request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt: '2026-10-15T17:00:00Z' },
    })],
  }), { now: NOW });
  assert.match(gaps[0]!.spoken, /David was asked and hasn't answered yet/);
  // The words that would turn a question into a commitment.
  assert.ok(!/is taking|will take|has it|agreed|confirmed/i.test(gaps[0]!.spoken));
});

test('a fresh ask lowers the risk; a stale one gives the relief back', () => {
  const make = (askedAt: string) => detectCareGaps(baseState({
    obligations: [obligation({
      status: 'REQUESTED', ownerId: null,
      request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt },
    })],
  }), { now: NOW })[0]!;

  const fresh = make('2026-10-15T17:30:00Z');   // half an hour ago
  const stale = make('2026-10-13T17:30:00Z');   // two days ago
  const unowned = detectCareGaps(
    baseState({ obligations: [obligation()] }), { now: NOW },
  )[0]!;

  assert.ok(fresh.score < stale.score, 'a fresh ask should rank below a stale one');
  assert.ok(stale.score <= unowned.score, 'relief must never exceed simply being unowned');
  assert.ok(fresh.score < unowned.score, 'asking someone should count for something');
});
