import type { CareStore } from '../store/store.js';

/**
 * The demo household: Margaret, her two adult children, and a paid aide.
 *
 * This is the family in the demo video. It is seeded rather than invented at
 * runtime so the story is identical every time it is shown, and so anyone who
 * clones the repo sees the same thing the video shows.
 */

export const DEMO_TOKENS: Record<string, string> = {
  'margaret-token': 'm_margaret',
  'david-token': 'm_david',
  'renee-token': 'm_renee',
  'aide-token': 'm_aide',
};

const HOUSEHOLD_ID = 'h_margaret';

export async function seedDemoHousehold(store: CareStore): Promise<void> {
  try {
    store.getCareState(HOUSEHOLD_ID);
    return; // already seeded
  } catch { /* not seeded yet */ }

  await store.addHousehold({
    id: HOUSEHOLD_ID,
    name: "Margaret's care circle",
    timezone: 'America/New_York',
  });

  await store.addMember({
    id: 'm_margaret', householdId: HOUSEHOLD_ID, name: 'Margaret',
    role: 'care_recipient', spokenAs: 'Mom',
  });
  await store.addMember({
    id: 'm_david', householdId: HOUSEHOLD_ID, name: 'David',
    role: 'primary_caregiver',
  });
  await store.addMember({
    id: 'm_renee', householdId: HOUSEHOLD_ID, name: 'Renee',
    role: 'caregiver',
  });
  await store.addMember({
    id: 'm_aide', householdId: HOUSEHOLD_ID, name: 'Tasha',
    role: 'helper',
  });

  await store.addMedication({
    id: 'med_heart', householdId: HOUSEHOLD_ID, name: 'heart pill',
    times: ['08:00', '20:00'], forMemberId: 'm_margaret',
  });
  await store.addMedication({
    id: 'med_thyroid', householdId: HOUSEHOLD_ID, name: 'thyroid tablet',
    times: ['08:00'], forMemberId: 'm_margaret',
  });
}
