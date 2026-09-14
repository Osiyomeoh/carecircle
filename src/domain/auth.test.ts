import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, canActOn, NotPermittedError, require as requireCap } from './auth.ts';
import { proposeFromAppointment } from './inference.ts';
import type { Member, Obligation, Role } from './types.ts';

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
