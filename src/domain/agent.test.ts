import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  AGENT_ID, deliberate, harmAvoided, interruptionCost, recentAsksOf,
} from './agent.ts';
import { candidatesFor } from './delegation.ts';
import type { CareEvent, CareState, Obligation } from './types.ts';

/** Wednesday 2026-10-14, 10:00 New York - a reasonable hour to ask somebody something. */
const DAYTIME = new Date('2026-10-14T14:00:00Z');
/** The same night, 02:00 New York. */
const NIGHT = new Date('2026-10-14T06:00:00Z');
const TZ = 'America/New_York';

function obligation(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1', householdId: 'h1',
    what: 'Drive Margaret to cardiology',
    status: 'OPEN', consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-10-12T12:00:00Z' },
    ownerId: null, createdAt: '2026-10-12T12:00:00Z',
    dueAt: '2026-10-15T14:00:00Z',
    ...over,
  };
}

function state(over: Partial<CareState> = {}): CareState {
  return {
    household: { id: 'h1', name: 'circle', timezone: TZ },
    members: [
      { id: 'm_margaret', householdId: 'h1', name: 'Margaret', role: 'care_recipient', spokenAs: 'Mom' },
      { id: 'm_david', householdId: 'h1', name: 'David', role: 'primary_caregiver' },
      { id: 'm_renee', householdId: 'h1', name: 'Renee', role: 'caregiver' },
      { id: 'm_aide', householdId: 'h1', name: 'Tasha', role: 'helper' },
    ],
    obligations: [obligation()],
    medications: [],
    events: [],
    ...over,
  };
}

function askEvent(memberId: string, at: string, by = AGENT_ID): CareEvent {
  return {
    id: `e_${memberId}_${at}`, householdId: 'h1', kind: 'owner_requested',
    reportedBy: by, occurredAt: at, recordedAt: at,
    data: { obligationId: 'o1', askedOfId: memberId },
  };
}

const opts = (now: Date) => ({ now, timezone: TZ });

// --- It acts at all --------------------------------------------------------

test('unowned work gets somebody asked, with nobody having said anything', () => {
  // The whole point: this happens with no human turn.
  const { actions } = deliberate(state(), opts(DAYTIME));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]!.kind, 'ASK');
  assert.ok(actions[0]!.memberId);
});

test('the agent asks - it never assigns', () => {
  // The rule that binds every human here binds the machine. An autonomous system
  // that could put work in someone's name while they slept is a different product.
  const { actions } = deliberate(state(), opts(DAYTIME));
  for (const a of actions) {
    assert.notEqual(a.kind as string, 'ASSIGN');
    assert.ok(['ASK', 'ESCALATE', 'STAND_DOWN'].includes(a.kind));
  }
});

test('work somebody already owns is left alone', () => {
  const owned = state({ obligations: [obligation({ status: 'ASSIGNED', ownerId: 'm_david' })] });
  assert.deepEqual(deliberate(owned, opts(DAYTIME)).actions, []);
});

test('a PROPOSED obligation is never pursued - the system does not chase its own guesses', () => {
  const guessed = state({ obligations: [obligation({ status: 'PROPOSED' })] });
  assert.deepEqual(deliberate(guessed, opts(DAYTIME)).actions, []);
});

// --- The bounds emerge from the policy -------------------------------------

test('nobody is woken at two in the morning over a ride three days out', () => {
  assert.deepEqual(deliberate(state(), opts(NIGHT)).actions, []);
});

test('the night is a cost, not a prohibition', () => {
  // Finite on purpose: a medical obligation minutes from its deadline should still
  // be able to clear it. A hard rule could not express that.
  const imminent = state({
    obligations: [obligation({ dueAt: new Date(NIGHT.getTime() + 15 * 60_000).toISOString() })],
  });
  const quiet = deliberate(imminent, opts(NIGHT));
  const cost = interruptionCost('m_david', imminent, opts(NIGHT));
  const day = interruptionCost('m_david', imminent, opts(DAYTIME));
  assert.ok(cost > day, 'night should cost more than day');
  assert.ok(Number.isFinite(cost), 'night must be a price, not a wall');
  // Whether this particular one clears the bar is the policy's call; what must hold
  // is that the agent explains itself either way.
  assert.ok(quiet.actions.length + quiet.restraint.length > 0);
});

test('asking the same person again costs more each time', () => {
  const asked = (n: number) => state({
    events: Array.from({ length: n }, (_, i) =>
      askEvent('m_david', new Date(DAYTIME.getTime() - (i + 1) * 3_600_000).toISOString())),
  });
  const costs = [0, 1, 2, 3].map((n) => interruptionCost('m_david', asked(n), opts(DAYTIME)));
  for (let i = 1; i < costs.length; i++) {
    assert.ok(costs[i]! > costs[i - 1]!, `ask ${i} did not cost more than ask ${i - 1}`);
  }
});

test('the agent eventually stops rather than badgering', () => {
  // Enough prior asks that no action can clear its own cost.
  const worn = state({
    events: ['m_david', 'm_renee', 'm_aide'].flatMap((m) =>
      Array.from({ length: 8 }, (_, i) =>
        askEvent(m, new Date(DAYTIME.getTime() - (i + 1) * 600_000).toISOString()))),
  });
  const { actions, restraint } = deliberate(worn, opts(DAYTIME));
  assert.deepEqual(actions, [], 'kept asking people it had already worn out');
  assert.ok(restraint.length > 0, 'went quiet without recording why');
});

test('a human asking somebody does not make the agent go quiet', () => {
  // Charging the machine for a sibling's request would silence it exactly when the
  // family is already trying to sort something out.
  const byHuman = state({
    events: Array.from({ length: 6 }, (_, i) =>
      askEvent('m_david', new Date(DAYTIME.getTime() - (i + 1) * 600_000).toISOString(), 'm_renee')),
  });
  assert.equal(recentAsksOf('m_david', byHuman, DAYTIME), 0);
});

test('fatigue wears off', () => {
  const old = state({
    events: [askEvent('m_david', new Date(DAYTIME.getTime() - 48 * 3_600_000).toISOString())],
  });
  assert.equal(recentAsksOf('m_david', old, DAYTIME), 0);
});

// --- It moves down the circle ---------------------------------------------

test('an unanswered ask moves to the next person, not back to the same one', () => {
  const pending = state({
    obligations: [obligation({
      status: 'REQUESTED',
      request: { askedOfId: 'm_renee', askedById: 'm_david', askedAt: new Date(DAYTIME.getTime() - 13 * 3_600_000).toISOString() },
    })],
  });
  const { actions } = deliberate(pending, opts(DAYTIME));
  const ask = actions.find((a) => a.kind === 'ASK');
  assert.ok(ask, 'a stale ask was left to rot');
  assert.notEqual(ask.memberId, 'm_renee', 'asked the same person twice');
});

test('a fresh ask is left to breathe', () => {
  const justAsked = state({
    obligations: [obligation({
      status: 'REQUESTED',
      request: { askedOfId: 'm_renee', askedById: 'm_david', askedAt: new Date(DAYTIME.getTime() - 30 * 60_000).toISOString() },
    })],
  });
  assert.deepEqual(deliberate(justAsked, opts(DAYTIME)).actions, []);
});

test('somebody who declined is never asked again about that work', () => {
  const declined = state({ obligations: [obligation({ declinedBy: ['m_renee', 'm_david'] })] });
  const { actions } = deliberate(declined, opts(DAYTIME));
  for (const a of actions) {
    assert.ok(!['m_renee', 'm_david'].includes(a.memberId ?? ''), 'asked somebody who said no');
  }
});

test('when the circle runs out, it escalates once and then lets go', () => {
  const exhausted = state({
    obligations: [obligation({
      status: 'REQUESTED',
      declinedBy: ['m_renee', 'm_aide'],
      request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt: new Date(DAYTIME.getTime() - 20 * 3_600_000).toISOString() },
    })],
  });
  const { actions, restraint } = deliberate(exhausted, opts(DAYTIME));
  assert.equal(actions.length, 0, 'kept going after everyone had been asked');
  assert.ok(restraint.some((r) => /run out of people/.test(r.because)));
});

// --- It explains itself ----------------------------------------------------

test('every action carries the arithmetic that produced it', () => {
  const { actions } = deliberate(state(), opts(DAYTIME));
  for (const a of actions) {
    assert.ok(a.value.harmAvoided > 0);
    assert.ok(a.value.interruptionCost > 0);
    // The number is not an opinion: it recomputes from its own parts.
    assert.ok(Math.abs(a.value.net - (a.value.harmAvoided - a.value.interruptionCost)) < 1e-9);
    assert.ok(a.value.net > 0, 'acted on an action that was not worth taking');
  }
});

test('staying quiet is recorded, not just implied', () => {
  // A system that only reports what it did is not auditable, and most of the time
  // this one decides to do nothing.
  const { actions, restraint } = deliberate(state(), opts(NIGHT));
  assert.deepEqual(actions, []);
  assert.ok(restraint.length > 0);
  assert.match(restraint[0]!.because, /night/i);
});

test('the reason names a person and the work, not a rule number', () => {
  const { actions } = deliberate(state(), opts(DAYTIME));
  const a = actions[0]!;
  assert.match(a.because, /cardiology/i);
  assert.equal(/threshold|score >|rule \d/i.test(a.because), false);
});

// --- Properties ------------------------------------------------------------

test('the agent never acts on an action whose value is not positive', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 12 }),
    fc.constantFrom('medical' as const, 'logistical' as const, 'social' as const),
    (hour, priorAsks, consequence) => {
      const now = new Date(Date.UTC(2026, 9, 14, hour, 0, 0));
      const s = state({
        obligations: [obligation({ consequence })],
        events: Array.from({ length: priorAsks }, (_, i) =>
          askEvent('m_david', new Date(now.getTime() - (i + 1) * 600_000).toISOString())),
      });
      for (const a of deliberate(s, opts(now)).actions) {
        assert.ok(a.value.net > 0);
      }
    },
  ), { numRuns: 300 });
});

test('the agent is bounded however much work piles up', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 60 }), (n) => {
    const many = state({
      obligations: Array.from({ length: n }, (_, i) => obligation({ id: `o${i}` })),
    });
    const { actions } = deliberate(many, opts(DAYTIME));
    assert.ok(actions.length <= 3, `emitted ${actions.length} actions for ${n} obligations`);
  }), { numRuns: 60 });
});

test('the same state at the same instant always decides the same thing', () => {
  // Determinism is the moat. An agent that drifts cannot be audited.
  const s = state();
  const a = deliberate(s, opts(DAYTIME));
  const b = deliberate(s, opts(DAYTIME));
  assert.deepEqual(a, b);
});

test('when it can only do a few things, it does the ones that matter most', () => {
  const mixed = state({
    obligations: [
      obligation({ id: 'o_social', consequence: 'social', what: 'Call about the church lunch' }),
      obligation({ id: 'o_medical', consequence: 'medical', what: 'Drive Mom to cardiology' }),
    ],
  });
  const { actions } = deliberate(mixed, opts(DAYTIME));
  assert.ok(actions.length > 0);
  assert.equal(actions[0]!.obligationId, 'o_medical', 'put the church lunch ahead of cardiology');
});

test('harm avoided is discounted by how loaded the candidate already is', () => {
  const s = state();
  const [first] = candidatesFor(s.obligations[0]!, s);
  assert.ok(first);
  const light = harmAvoided(s.obligations[0]!, { ...first, load: 0 }, s, DAYTIME);
  const heavy = harmAvoided(s.obligations[0]!, { ...first, load: 5 }, s, DAYTIME);
  assert.ok(light > heavy, 'asking an overloaded person was valued the same as asking a free one');
});
