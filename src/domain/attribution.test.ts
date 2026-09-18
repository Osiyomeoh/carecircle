import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionOf, isReported, namesItsSource, sayWhoSaysSo } from './attribution.ts';
import { detectCareGaps } from './gaps.ts';
import type { CareEvent, CareState } from './types.ts';

/** Wednesday 2026-10-15, 14:00 in New York. */
const NOW = new Date('2026-10-15T18:00:00Z');

const NAMES: Record<string, string> = {
  m_alex: 'Alex', m_aide: 'Tasha', m_david: 'David',
};
const nameOf = (id: string) => NAMES[id] ?? null;

function dose(reportedBy: string, aboutMemberId = 'm_alex'): CareEvent {
  return {
    id: 'e1', householdId: 'h1', kind: 'medication_taken',
    reportedBy,
    occurredAt: '2026-10-15T12:00:00Z', // 08:00 New York
    recordedAt: '2026-10-15T12:00:00Z',
    data: { medicationId: 'med1', aboutMemberId },
  };
}

function stateWith(events: CareEvent[]): CareState {
  return {
    household: { id: 'h1', name: 'circle', timezone: 'America/New_York' },
    members: [
      { id: 'm_alex', householdId: 'h1', name: 'Alex', role: 'care_recipient' },
      { id: 'm_aide', householdId: 'h1', name: 'Tasha', role: 'helper' },
    ],
    medications: [
      { id: 'med1', householdId: 'h1', name: 'baclofen', times: ['08:00'], forMemberId: 'm_alex' },
    ],
    obligations: [],
    events,
  } as CareState;
}

test('somebody else speaking about you is not you speaking for yourself', () => {
  // The defect this file exists for: these two were once byte-identical.
  assert.deepEqual(attributionOf(dose('m_alex')), { kind: 'FIRST_HAND', memberId: 'm_alex' });
  assert.deepEqual(attributionOf(dose('m_aide')), {
    kind: 'REPORTED', byMemberId: 'm_aide', aboutMemberId: 'm_alex',
  });
});

test('logging something about yourself needs no aboutMemberId to count as first-hand', () => {
  const e = dose('m_alex');
  delete (e.data as Record<string, unknown>)['aboutMemberId'];
  assert.equal(attributionOf(e).kind, 'FIRST_HAND');
});

test('a proxy record still closes the gap completely', () => {
  // The rule that is easy to get wrong. Treating the aide's word as weaker
  // evidence is the same accusation from the other direction, and it would
  // punish the households that depend on proxies most.
  const gaps = detectCareGaps(stateWith([dose('m_aide')]), { now: NOW });
  assert.deepEqual(gaps, [], 'doubted a record a real person made');
});

test('a proxy record is reported exactly as confidently as a first-hand one', () => {
  const byProxy = detectCareGaps(stateWith([dose('m_aide')]), { now: NOW });
  const byThemselves = detectCareGaps(stateWith([dose('m_alex')]), { now: NOW });
  assert.deepEqual(byProxy, byThemselves,
    'the distinction belongs in the language, never in the doubt');
});

test('an absent record is still an absent record, whoever might have made it', () => {
  const gaps = detectCareGaps(stateWith([]), { now: NOW });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]!.spoken, /no record/);
});

test('a proxy record always names who made it', () => {
  const spoken = sayWhoSaysSo(attributionOf(dose('m_aide')), nameOf);
  assert.match(spoken, /Tasha/);
  assert.match(spoken, /Alex/);
});

test('a first-hand record is phrased as the person, not as a file note about them', () => {
  const spoken = sayWhoSaysSo(attributionOf(dose('m_alex')), nameOf);
  assert.match(spoken, /Alex logged it themselves/);
  // "Alex logged that Alex took it" is stilted and subtly distancing.
  assert.equal(/Alex.*Alex/.test(spoken), false);
});

test('nobody is assigned a pronoun the record does not hold', () => {
  const said = [
    sayWhoSaysSo(attributionOf(dose('m_alex')), nameOf),
    sayWhoSaysSo(attributionOf(dose('m_aide')), nameOf),
  ].join(' ');
  assert.equal(/\b(he|she|his|her|hers|him)\b/i.test(said), false);
});

test('an unknown reporter is still disclosed rather than silently dropped', () => {
  // Falling back to the subject's own word would be the exact failure.
  const spoken = sayWhoSaysSo(attributionOf(dose('m_stranger')), nameOf);
  assert.match(spoken, /Someone/);
  assert.equal(spoken.includes('themselves'), false);
});

test('the invariant catches a line that hides where a record came from', () => {
  const proxy = attributionOf(dose('m_aide'));
  assert.equal(namesItsSource('One medication logged today.', proxy, nameOf), false);
  assert.equal(namesItsSource('Tasha logged it for Alex.', proxy, nameOf), true);
});

test('a first-hand record carries no obligation to name anybody else', () => {
  // There is no second party in the claim to name.
  assert.equal(namesItsSource('One medication logged today.', attributionOf(dose('m_alex')), nameOf), true);
});

test('isReported agrees with attributionOf on every event it sees', () => {
  for (const who of ['m_alex', 'm_aide', 'm_david', 'device:ring']) {
    assert.equal(isReported(dose(who)), attributionOf(dose(who)).kind === 'REPORTED');
  }
});
