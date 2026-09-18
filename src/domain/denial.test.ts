import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesOf, can, NotPermittedError, require as requireCap } from './auth.ts';
import type { Member, Role } from './types.ts';

const member = (role: Role): Member =>
  ({ id: `m_${role}`, householdId: 'h1', name: 'Person', role });

function denialFor(role: Role, capability: Parameters<typeof requireCap>[1]): string {
  try {
    requireCap(member(role), capability);
    return '';
  } catch (err) {
    assert.ok(err instanceof NotPermittedError);
    return err.message;
  }
}

test('the care recipient is never told she lacks access to her own day', () => {
  // The live failure: Margaret asked "can someone drive me Thursday?" - the most
  // ordinary sentence in this system - and got the aide's shift-scoped refusal.
  const said = denialFor('care_recipient', 'read_full_state');
  assert.equal(/your shift/i.test(said), false, `aide language said to the care recipient: ${said}`);
  assert.match(said, /your day/i);
});

test('a refusal to the care recipient names something she can actually do', () => {
  const said = denialFor('care_recipient', 'read_full_state');
  // She holds request_owner. The turn died because the refusal never said so.
  assert.ok(can(member('care_recipient'), 'request_owner'));
  assert.match(said, /ask someone|take something on/i,
    `dead-end refusal, with the tool one call away: ${said}`);
});

test('the aide still gets the shift-scoped refusal, which is right for them', () => {
  const said = denialFor('helper', 'read_full_state');
  assert.match(said, /shift/i);
});

test('every refusal offers a way forward rather than only saying no', () => {
  // A dead end is where a model starts improvising.
  const cases: [Role, Parameters<typeof requireCap>[1]][] = [
    ['helper', 'assign_obligation'],
    ['caregiver', 'assign_obligation'],
    ['care_recipient', 'read_full_state'],
    ['helper', 'read_full_state'],
    ['care_recipient', 'assign_obligation'],
  ];
  for (const [role, capability] of cases) {
    const said = denialFor(role, capability);
    assert.ok(said.length > 0, `${role}/${capability} had no refusal text`);
    assert.match(said, /\byou can\b|\bi can\b|\byou could\b|\bor i\b/i,
      `${role}/${capability} is a dead end: ${said}`);
  }
});

test('no refusal accuses the person of anything', () => {
  for (const role of ['care_recipient', 'helper', 'caregiver'] as Role[]) {
    for (const capability of ['read_full_state', 'assign_obligation', 'escalate'] as const) {
      const said = denialFor(role, capability);
      if (!said) continue;
      assert.equal(/not allowed|forbidden|denied|unauthorized/i.test(said), false,
        `${role}/${capability} reads as a security error: ${said}`);
    }
  }
});

test('capabilitiesOf reports exactly what can() agrees with', () => {
  for (const role of ['care_recipient', 'primary_caregiver', 'caregiver', 'helper'] as Role[]) {
    for (const capability of capabilitiesOf(member(role))) {
      assert.ok(can(member(role), capability), `${role} was listed for ${capability} but cannot`);
    }
  }
});

test('the care recipient can ask her family for help, and cannot assign it', () => {
  // The line the whole product turns on: participant, not subject.
  assert.ok(can(member('care_recipient'), 'request_owner'));
  assert.equal(can(member('care_recipient'), 'assign_obligation'), false);
});
