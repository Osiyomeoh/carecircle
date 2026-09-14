import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, canActOn, NotPermittedError, require as requireCap } from './auth.ts';
import { orphanedBy, proposeFromAppointment } from './inference.ts';
import type { Member, Obligation, Role } from './types.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';

const member = (role: Role, id = 'm1'): Member =>
  ({ id, householdId: 'h1', name: 'Test', role });

test('only the primary caregiver can assign work to others', () => {
  assert.ok(can(member('primary_caregiver'), 'assign_obligation'));
  assert.ok(!can(member('caregiver'), 'assign_obligation'));
  assert.ok(!can(member('helper'), 'assign_obligation'));
});

test('a caregiver can still claim work themselves', () => {
  assert.ok(can(member('caregiver'), 'claim_obligation'));
});

test('the care recipient can log their own events', () => {
  assert.ok(can(member('care_recipient'), 'log_own_event'));
});

test('a helper cannot see the full care record', () => {
  assert.ok(!can(member('helper'), 'read_full_state'));
  assert.ok(can(member('helper'), 'read_shift'));
});

test('denial messages tell the person what they can do instead', () => {
  try {
    requireCap(member('caregiver'), 'assign_obligation');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof NotPermittedError);
    // Written to be spoken, and to keep the conversation moving.
    assert.match(err.message, /take it on yourself/);
  }
});

test('a helper can only act on work they own', () => {
  const obligation = { id: 'o1', ownerId: 'someone_else' } as Obligation;
  assert.ok(!canActOn(member('helper'), obligation));
  assert.ok(canActOn(member('helper'), { ...obligation, ownerId: 'm1' }));
  assert.ok(canActOn(member('caregiver'), obligation));
});

test('an appointment proposes transport, and says it is guessing', () => {
  const seeds = proposeFromAppointment('cardiology', 'Mom', '2026-10-16T14:00:00Z');
  const transport = seeds.find((s) => s.provenance.rule === 'medical-appointment-transport');
  assert.ok(transport);
  assert.equal(transport.provenance.kind, 'INFERRED');
  assert.match(transport.ask, /I'm guessing/);
  assert.equal(transport.dueAt, '2026-10-16T14:00:00Z');
});

test('a non-medical event proposes nothing', () => {
  assert.deepEqual(proposeFromAppointment('book club', 'Mom', '2026-10-16T14:00:00Z'), []);
});

test('an unavailability orphans work that person was covering', () => {
  const thursday = '2026-10-15T14:00:00Z';
  const obligations = [
    { id:'o1', ownerId:'m_renee', status:'ASSIGNED', dueAt:thursday, what:'Drive Mom to cardiology' },
    { id:'o2', ownerId:'m_david', status:'ASSIGNED', dueAt:thursday, what:'Pick up prescription' },
    { id:'o3', ownerId:'m_renee', status:'RESOLVED', dueAt:thursday, what:'Already done' },
  ] as unknown as Obligation[];

  const orphaned = orphanedBy(
    { memberId:'m_renee', from:'2026-10-15T00:00:00Z', to:'2026-10-15T23:59:00Z' },
    obligations,
    () => 'Renee',
  );

  // Only Renee's still-open work in that window. Nobody else's, nothing already done.
  assert.deepEqual(orphaned.map((o) => o.obligationId), ['o1']);
  assert.match(orphaned[0]!.ask, /Does someone else need to pick it up/);
});

test('an unavailability outside the window orphans nothing', () => {
  const obligations = [
    { id:'o1', ownerId:'m_renee', status:'ASSIGNED', dueAt:'2026-11-20T14:00:00Z', what:'Drive Mom' },
  ] as unknown as Obligation[];
  assert.deepEqual(
    orphanedBy({ memberId:'m_renee', from:'2026-10-15T00:00:00Z', to:'2026-10-15T23:59:00Z' },
      obligations, () => 'Renee'),
    [],
  );
});

test('the scenario puts cardiology on a real Thursday at 10:00 New York', async () => {
  // The video says "Thursday at ten". A card reading "Wednesday at 6:44 AM" while
  // the narrator says Thursday is the kind of detail a judge notices.
  const store = new CareStore();
  await store.reset();
  await seedDemoHousehold(store);
  const { cardiologyAt } = await seedScenario(store, 'h_margaret');

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(cardiologyAt).map((p) => [p.type, p.value]));
  assert.equal(parts['weekday'], 'Thursday');
  assert.equal(Number(parts['hour']) % 24, 10);
  assert.equal(parts['minute'], '00');
  assert.ok(cardiologyAt.getTime() > Date.now(), 'must be in the future');
});

test('the scenario opens with the ride unowned and the evening dose unrecorded', async () => {
  const store = new CareStore();
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const state = store.getCareState('h_margaret');

  const ride = state.obligations.find((o) => o.what.includes('Drive Mom'));
  assert.equal(ride?.status, 'OPEN');
  assert.equal(ride?.ownerId, null);

  // Morning doses logged; the evening one deliberately absent.
  const logged = state.events.filter((e) => e.kind === 'medication_taken');
  assert.equal(logged.length, 2);
});
