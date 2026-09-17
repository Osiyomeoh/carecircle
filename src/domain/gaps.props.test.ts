import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { detectCareGaps } from './gaps.ts';
import type {
  CareState, ConsequenceClass, Obligation, Provenance,
} from './types.ts';

/**
 * Property-based tests: we do not check examples, we check the laws the risk model
 * must obey, over thousands of randomly generated care states. If any generated
 * input violates an invariant, fast-check shrinks it to a minimal counterexample.
 *
 * The invariants are the model's contract with the trust story:
 *  - bounded:      a score is always a probability-weighted cost in [0,100]
 *  - deterministic:the same state and `now` always yield identical gaps
 *  - confidence:   an assumption can never outrank the identical known fact
 *  - imminence:    a nearer deadline can never lower risk
 *  - cost:         worse consequence can never lower risk
 */

const NOW = new Date('2026-10-15T18:00:00Z');
const H = 3_600_000;

const consequence: fc.Arbitrary<ConsequenceClass> =
  fc.constantFrom('medical', 'logistical', 'social');

/** A provenance whose ordinal confidence we know, for dominance tests. */
const provenanceByRank: Record<number, Provenance> = {
  0: { kind: 'INFERRED', rule: 'r', from: 'x' },      // 0.6
  1: { kind: 'NOT_LOGGED', expectedAt: '2026-10-13T12:00:00Z' }, // 0.75
  2: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-10-13T12:00:00Z' }, // 1.0
};

function baseState(obligations: Obligation[]): CareState {
  return {
    household: { id: 'h1', name: 'circle', timezone: 'America/New_York' },
    members: [
      { id: 'm_margaret', householdId: 'h1', name: 'Margaret', role: 'care_recipient', spokenAs: 'Mom' },
      { id: 'm_renee', householdId: 'h1', name: 'Renee', role: 'caregiver' },
    ],
    events: [],
    obligations,
    medications: [],
  };
}

/** An OPEN, unowned obligation - the case that always produces exactly one gap. */
function unclaimed(over: Partial<Obligation>): Obligation {
  return {
    id: 'o1', householdId: 'h1', what: 'task', status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-10-13T12:00:00Z' },
    ownerId: null, createdAt: '2026-10-13T12:00:00Z', ...over,
  };
}

/** hoursFromNow -> ISO string. */
const dueAtFrom = (hours: number) => new Date(NOW.getTime() + hours * H).toISOString();

test('property: every gap score is bounded to [0,100]', () => {
  fc.assert(fc.property(
    fc.array(fc.record({
      consequence,
      rank: fc.integer({ min: 0, max: 2 }),
      dueHours: fc.integer({ min: -240, max: 720 }),
      ageHours: fc.integer({ min: 0, max: 500 }),
      dated: fc.boolean(),
    }), { maxLength: 8 }),
    (specs) => {
      const obligations = specs.map((s, i) => unclaimed({
        id: `o${i}`,
        consequence: s.consequence,
        provenance: provenanceByRank[s.rank]!,
        createdAt: new Date(NOW.getTime() - s.ageHours * H).toISOString(),
        ...(s.dated ? { dueAt: dueAtFrom(s.dueHours) } : {}),
      }));
      for (const g of detectCareGaps(baseState(obligations), { now: NOW })) {
        assert.ok(g.score >= 0 && g.score <= 100, `score ${g.score} out of range`);
        assert.ok(Number.isFinite(g.score));
      }
    },
  ));
});

test('property: detection is deterministic for a fixed now', () => {
  fc.assert(fc.property(
    fc.integer({ min: -240, max: 720 }), consequence, fc.integer({ min: 0, max: 2 }),
    (dueHours, cons, rank) => {
      const state = baseState([unclaimed({
        consequence: cons, provenance: provenanceByRank[rank]!, dueAt: dueAtFrom(dueHours),
      })]);
      assert.deepEqual(detectCareGaps(state, { now: NOW }), detectCareGaps(state, { now: NOW }));
    },
  ));
});

test('property: higher confidence never lowers score (Known >= Assumed)', () => {
  fc.assert(fc.property(
    fc.integer({ min: -240, max: 720 }), consequence,
    (dueHours, cons) => {
      const score = (rank: number) => detectCareGaps(
        baseState([unclaimed({ consequence: cons, provenance: provenanceByRank[rank]!, dueAt: dueAtFrom(dueHours) })]),
        { now: NOW },
      )[0]!.score;
      // INFERRED (0.6) <= NOT_LOGGED (0.75) <= CONFIRMED (1.0)
      assert.ok(score(0) <= score(1) && score(1) <= score(2));
    },
  ));
});

test('property: a nearer deadline never lowers score (imminence monotone)', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 700 }), fc.integer({ min: 1, max: 700 }), consequence,
    (a, b, cons) => {
      const [near, far] = a <= b ? [a, b] : [b, a];
      const score = (hours: number) => detectCareGaps(
        baseState([unclaimed({ consequence: cons, dueAt: dueAtFrom(hours) })]),
        { now: NOW },
      )[0]!.score;
      assert.ok(score(near) >= score(far), `near ${score(near)} < far ${score(far)}`);
    },
  ));
});

test('property: worse consequence never lowers score (medical >= logistical >= social)', () => {
  fc.assert(fc.property(
    fc.integer({ min: -240, max: 720 }),
    (dueHours) => {
      const score = (cons: ConsequenceClass) => detectCareGaps(
        baseState([unclaimed({ consequence: cons, dueAt: dueAtFrom(dueHours) })]),
        { now: NOW },
      )[0]!.score;
      assert.ok(score('medical') >= score('logistical') && score('logistical') >= score('social'));
    },
  ));
});
