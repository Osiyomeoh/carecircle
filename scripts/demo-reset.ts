/**
 * Reset the demo to the state the video opens on.
 *
 *   npm run demo:reset            fresh state, ride unclaimed
 *   npm run demo:reset -- --claimed   ride already claimed by Renee, so the
 *                                     constraint beat ("I can't drive Thursday")
 *                                     can orphan it live on camera
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { seedDemoHousehold } from '../src/demo/seed.ts';
import { seedScenario } from '../src/demo/scenario.ts';
import { detectCareGaps } from '../src/domain/gaps.ts';

const dbPath = process.env.CARECIRCLE_DB ?? 'carecircle.db.json';
const claimed = process.argv.includes('--claimed');

const store = new CareStore(new FilePersistence(dbPath));
await store.reset();
await seedDemoHousehold(store);
const { cardiologyAt } = await seedScenario(store, 'h_margaret', {
  rideClaimedByRenee: claimed,
});

const state = store.getCareState('h_margaret');
const gaps = detectCareGaps(state);

const when = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
}).format(cardiologyAt);

console.log(`Demo reset - ${dbPath}`);
console.log(`  Cardiology: ${when} (America/New_York)`);
console.log(`  Ride: ${claimed ? 'claimed by Renee' : 'unclaimed'}`);
console.log(`\nOpening Care Gaps (${gaps.length}):`);
for (const g of gaps) console.log(`  [${g.severity.padEnd(6)}] ${g.spoken}`);
