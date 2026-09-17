/**
 * Round-trip check against real DynamoDB.
 *
 * Seeds a household, saves, reloads through a fresh adapter, and asserts the care
 * record came back identical - then mutates and confirms only the changed rows are
 * written. Uses a throwaway household id so it never touches demo data.
 */
import assert from 'node:assert/strict';
import { CareStore } from '../src/store/store.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import { detectCareGaps } from '../src/domain/gaps.ts';

const table = process.env.CARECIRCLE_TABLE ?? 'carecircle';
const region = process.env.AWS_REGION ?? 'us-east-1';
const hh = `h_roundtrip_${Date.now()}`;

const say = (s: string) => console.log(`  ${s}`);

console.log(`\nDynamoDB round trip · table=${table} region=${region}`);

// --- write ---------------------------------------------------------------
const store = new CareStore(new DynamoPersistence({ tableName: table, region }));
await store.init();

await store.addHousehold({ id: hh, name: 'Round trip', timezone: 'America/New_York' });
await store.addMember({ id: `${hh}_mom`, householdId: hh, name: 'Margaret', role: 'care_recipient', spokenAs: 'Mom' });
await store.addMember({ id: `${hh}_david`, householdId: hh, name: 'David', role: 'primary_caregiver' });
await store.addMedication({ id: `${hh}_med`, householdId: hh, name: 'heart pill', times: ['08:00', '20:00'], forMemberId: `${hh}_mom` });

const due = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
const ride = await store.createObligation({
  householdId: hh, what: 'Drive Mom to cardiology', status: 'OPEN', consequence: 'medical',
  provenance: { kind: 'INFERRED', rule: 'medical-appointment-transport', from: 'cardiology appointment' },
  ownerId: null, dueAt: due,
});
await store.appendEvent({
  householdId: hh, kind: 'note_added', reportedBy: `${hh}_david`,
  occurredAt: new Date().toISOString(), detail: 'Mom sounded tired on the phone.',
  data: { aboutMemberId: `${hh}_mom` },
});
say('wrote household, 2 members, 1 medication, 1 obligation, 1 event');

// --- read back through a completely fresh adapter ------------------------
const reloaded = new CareStore(new DynamoPersistence({ tableName: table, region }));
await reloaded.init();
const state = reloaded.getCareState(hh);

assert.equal(state.household.name, 'Round trip');
assert.equal(state.members.length, 2);
assert.equal(state.medications.length, 1);
assert.equal(state.obligations.length, 1);
assert.equal(state.events.length, 1);
assert.equal(state.events[0]?.detail, 'Mom sounded tired on the phone.');
say('reloaded through a fresh adapter - all entities intact');

// The gap engine must reach the same conclusion from persisted state.
const gaps = detectCareGaps(state);
assert.ok(gaps.some((g) => g.kind === 'UNCLAIMED'), 'expected the unowned ride to be a gap');
say(`gap engine agrees: ${gaps.length} gap(s), including the unclaimed ride`);

// --- mutate, and confirm the diff only writes what changed ---------------
await reloaded.transition(ride.id, hh, 'ASSIGNED', `${hh}_david`, { ownerId: `${hh}_david` });

const third = new CareStore(new DynamoPersistence({ tableName: table, region }));
await third.init();
const after = third.getCareState(hh);
assert.equal(after.obligations[0]?.status, 'ASSIGNED');
assert.equal(after.obligations[0]?.ownerId, `${hh}_david`);
assert.equal(third.getTransitions(ride.id).length, 1, 'the transition should be persisted');
say('claimed the ride; status, owner and audit trail all survived a reload');

// --- provenance survives serialisation -----------------------------------
assert.equal(after.obligations[0]?.provenance.kind, 'INFERRED');
say('provenance preserved - an inference did not come back as a fact');

// --- the diff-only claim, measured rather than asserted ------------------
const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
let itemsWritten = 0;
const realSend = doc.send.bind(doc);
(doc as unknown as { send: typeof realSend }).send = ((command: any) => {
  const batch = command?.input?.RequestItems?.[table];
  if (Array.isArray(batch)) itemsWritten += batch.length;
  return realSend(command);
}) as typeof realSend;

const counted = new CareStore(new DynamoPersistence({ tableName: table, client: doc }));
await counted.init();
itemsWritten = 0;

await counted.appendEvent({
  householdId: hh, kind: 'note_added', reportedBy: `${hh}_david`,
  occurredAt: new Date().toISOString(), detail: 'One more note.',
  data: { aboutMemberId: `${hh}_mom` },
});

// Eight entities now exist. A naive snapshot writer would rewrite all of them.
assert.equal(itemsWritten, 1, `expected 1 item written, got ${itemsWritten}`);
say(`diff-only writes confirmed: 1 item written for 1 change, not the whole snapshot`);

console.log('\n  PASS - the care record round-trips through DynamoDB\n');
console.log(`  (left household ${hh} in the table; delete with infra/delete-household.sh)`);
