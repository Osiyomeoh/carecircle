import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';
import { runAgentOnce } from './agent-runner.ts';
import { AGENT_ID } from './agent.ts';

const HH = 'h1';
const DAYTIME = new Date('2026-10-14T14:00:00Z'); // 10:00 New York

const store = new CareStore();
const notifier = new RecordOnlyNotifier();

async function seed(): Promise<string> {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  await store.addMember({ id: 'm_david', householdId: HH, name: 'David', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_renee', householdId: HH, name: 'Renee', role: 'caregiver' });
  const o = await store.createObligation({
    householdId: HH, what: 'Drive Margaret to cardiology', consequence: 'medical',
    status: 'OPEN', ownerId: null,
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-10-12T12:00:00Z' },
    dueAt: '2026-10-15T14:00:00Z',
  });
  return o.id;
}

beforeEach(seed);

test('a background pass moves unowned work to REQUESTED, owner still null', async () => {
  const id = await runAgentOnce(HH, { store, notifier, now: () => DAYTIME })
    .then((r) => r.performed[0]?.action.obligationId);
  assert.ok(id);
  const o = store.getObligation(id, HH);
  assert.equal(o.status, 'REQUESTED');
  assert.equal(o.ownerId, null, 'the agent took ownership - it must only ask');
});

test('the ask is attributed to the system, not to a person', async () => {
  await runAgentOnce(HH, { store, notifier, now: () => DAYTIME });
  const asks = store.getCareState(HH).events.filter((e) => e.kind === 'owner_requested');
  assert.equal(asks.length, 1);
  assert.equal(asks[0]!.reportedBy, AGENT_ID);
});

test('the arithmetic is written into the log, so the decision is auditable later', async () => {
  await runAgentOnce(HH, { store, notifier, now: () => DAYTIME });
  const ask = store.getCareState(HH).events.find((e) => e.kind === 'owner_requested')!;
  const value = ask.data['value'] as { net: number };
  assert.ok(value && value.net > 0);
  assert.match(ask.data['because'] as string, /cardiology/i);
});

test('running twice in the fatigue window does not ask twice', async () => {
  // Idempotence is what makes it safe on a timer. The second pass sees its own
  // first ask and the fresh REQUESTED state, and stands down.
  await runAgentOnce(HH, { store, notifier, now: () => DAYTIME });
  const second = await runAgentOnce(HH, { store, notifier, now: () => new Date(DAYTIME.getTime() + 60_000) });
  assert.equal(second.performed.length, 0, 'asked again a minute later');
});

test('a middle-of-the-night pass performs nothing and says why', async () => {
  const night = new Date('2026-10-14T06:00:00Z'); // 02:00 New York
  const run = await runAgentOnce(HH, { store, notifier, now: () => night });
  assert.equal(run.performed.length, 0);
  assert.ok(run.deliberation.restraint.length > 0);
});

test('a notification is delivered for the ask', async () => {
  const delivered: string[] = [];
  const spy = { channel: 'spy', deliver: async (m: { to: string }) => { delivered.push(m.to); return { delivered: true }; } };
  await runAgentOnce(HH, { store, notifier: spy as never, now: () => DAYTIME });
  assert.equal(delivered.length, 1);
});
