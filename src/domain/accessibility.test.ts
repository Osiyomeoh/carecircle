import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  accessibilityUplift, dignityNote, resolveSubjectAttributes,
} from './accessibility.ts';
import { detectCareGaps } from './gaps.ts';
import type { CareState, Entity, EntityAttributes, Member, Obligation } from './types.ts';

/**
 * The widening's whole point is that accessibility becomes a fact the graph carries into
 * risk WITHOUT becoming a judgement about the person. These tests try to make it demean -
 * with every attribute combination, over generated inputs - and assert two refusals hold:
 * the note is always about the task, never the person; and the uplift can only raise a
 * gap's rank, never lower it or invent one.
 */

// The verdicts this system must be structurally incapable of speaking about a disabled
// person. A disability is a fact about the world; "she's a burden" is a claim about her
// worth, and the system does not get to make it - the same refusal as the accusation ban,
// one level over.
const DEMEANING =
  /\bburden\b|helpless|\binvalid\b|wheelchair[- ]?bound|confined to|\bsuffers?\b|\bvictim\b|can'?t cope|incapable|pitiful|special needs|poor (thing|dear)|\bafflicted\b/i;

function member(over: Partial<Member> = {}): Member {
  return { id: 'm_margaret', householdId: 'h1', name: 'Margaret', role: 'care_recipient', spokenAs: 'Mom', ...over };
}

test('no attributes changes nothing - zero uplift, no note', () => {
  assert.equal(accessibilityUplift(undefined), 0);
  assert.equal(accessibilityUplift({}), 0);
  assert.equal(dignityNote(undefined), undefined);
  assert.equal(dignityNote({}), undefined);
});

test('accessible transport raises drop-risk and is explained as a logistics fact', () => {
  const attrs: EntityAttributes = { needsAccessibleTransport: true };
  assert.ok(accessibilityUplift(attrs) > 0);
  const note = dignityNote(attrs);
  assert.match(note!, /accessible transport/i);
  assert.match(note!, /fall-back/i);
  // It talks about the ride, never about her.
  assert.doesNotMatch(note!, DEMEANING);
  assert.doesNotMatch(note!, /\bshe\b|\bher\b|\bhim\b|\bthey\b/i);
});

test('needing hands-on help narrows who can own it, spoken about the task', () => {
  const note = dignityNote({ requiresAssistance: true });
  assert.match(note!, /hands-on help/i);
  assert.match(note!, /not everyone in the circle can pick it up/i);
  assert.doesNotMatch(note!, DEMEANING);
});

test('both needs combine into one sentence, still never demeaning', () => {
  const note = dignityNote({ needsAccessibleTransport: true, requiresAssistance: true });
  assert.match(note!, /accessible transport/i);
  assert.match(note!, /hands-on help/i);
  assert.doesNotMatch(note!, DEMEANING);
});

test('the subject resolves from a member, and a member wins over an entity of the same id', () => {
  const state = {
    members: [member({ id: 's1', attributes: { requiresAssistance: true } })],
    entities: [{ id: 's1', householdId: 'h1', type: 'service', name: 'x', attributes: { needsAccessibleTransport: true } } as Entity],
  };
  const o = { aboutEntityId: 's1' } as Obligation;
  assert.deepEqual(resolveSubjectAttributes(state, o), { requiresAssistance: true });
});

test('the subject resolves from a non-person entity when no member matches', () => {
  const state = {
    members: [] as Member[],
    entities: [{ id: 'e_ride', householdId: 'h1', type: 'service', name: 'Access-A-Ride', attributes: { needsAccessibleTransport: true } } as Entity],
  };
  const o = { aboutEntityId: 'e_ride' } as Obligation;
  assert.deepEqual(resolveSubjectAttributes(state, o), { needsAccessibleTransport: true });
});

// --- Integration through the real gap engine ------------------------------------------

function rideState(attrs?: EntityAttributes): CareState {
  return {
    household: { id: 'h1', name: 'circle', timezone: 'America/New_York' },
    members: [member(attrs ? { attributes: attrs } : {})],
    events: [],
    obligations: [{
      id: 'o_ride', householdId: 'h1', what: 'Drive Mom to cardiology',
      status: 'OPEN', consequence: 'medical',
      provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: '2026-03-10T09:00:00Z' },
      ownerId: null, aboutEntityId: 'm_margaret',
      dueAt: '2026-03-12T14:00:00Z', createdAt: '2026-03-10T09:00:00Z',
    }],
    medications: [],
    entities: [],
  };
}

const NOW = new Date('2026-03-11T09:00:00Z');

test('an accessible-transport ride ranks strictly above the identical ordinary ride', () => {
  const plain = detectCareGaps(rideState(), { now: NOW })[0]!;
  const access = detectCareGaps(rideState({ needsAccessibleTransport: true }), { now: NOW })[0]!;
  assert.equal(access.obligationId, 'o_ride');
  assert.ok(access.score > plain.score, `expected ${access.score} > ${plain.score}`);
  // The reason is auditable and dignified: it says WHY it ranks higher, about the ride.
  assert.match(access.because, /accessible transport/i);
  assert.doesNotMatch(access.because, DEMEANING);
  // Never accusatory either - the whole spoken/because surface stays clean.
  assert.doesNotMatch(access.spoken, DEMEANING);
});

test('the accessibility uplift can never lower a score', () => {
  const plain = detectCareGaps(rideState(), { now: NOW })[0]!;
  const access = detectCareGaps(rideState({ requiresAssistance: true }), { now: NOW })[0]!;
  assert.ok(access.score >= plain.score);
});

// --- Property: over any attribute set, both refusals hold -----------------------------

const arbAttrs: fc.Arbitrary<EntityAttributes> = fc.record({
  needsAccessibleTransport: fc.boolean(),
  requiresAssistance: fc.boolean(),
});

test('property: uplift stays a probability and the note never demeans', () => {
  fc.assert(fc.property(arbAttrs, (attrs) => {
    const u = accessibilityUplift(attrs);
    assert.ok(u >= 0 && u < 1, `uplift ${u} out of [0,1)`);
    const note = dignityNote(attrs);
    if (note !== undefined) assert.doesNotMatch(note, DEMEANING);
  }), { numRuns: 200 });
});

test('property: attaching any accessibility need never lowers the gap score', () => {
  fc.assert(fc.property(arbAttrs, (attrs) => {
    const plain = detectCareGaps(rideState(), { now: NOW })[0]!;
    const withAttrs = detectCareGaps(rideState(attrs), { now: NOW })[0]!;
    assert.ok(withAttrs.score >= plain.score);
    assert.doesNotMatch(withAttrs.because, DEMEANING);
  }), { numRuns: 200 });
});
