import type { CareStore } from '../store/store.js';

/**
 * The demo scenario.
 *
 * Stages the exact state the video opens on, so what is on screen matches what is
 * being said. "Cardiology Thursday at ten" has to genuinely be a Thursday at 10:00
 * in the household's timezone — a card reading "Wednesday at 6:44 AM" while the
 * narrator says Thursday is the kind of detail a judge notices and nobody forgives.
 */

const NY = 'America/New_York';

/** The UTC instant corresponding to a local wall-clock time in a timezone. */
function localTimeToUtc(date: Date, hour: number, minute: number, timezone: string): Date {
  // Start from the naive UTC guess, then correct by the zone's offset at that moment.
  const guess = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0,
  ));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', hour12: false, minute: '2-digit',
  }).formatToParts(guess);
  const asLocalHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const asLocalMin = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const driftMinutes = (asLocalHour * 60 + asLocalMin) - (hour * 60 + minute);
  return new Date(guess.getTime() - driftMinutes * 60_000);
}

/** The next occurrence of a weekday (0=Sun) at a local time, strictly in the future. */
function nextWeekdayAt(
  weekday: number, hour: number, minute: number, from: Date, timezone: string,
): Date {
  for (let addDays = 0; addDays <= 14; addDays += 1) {
    const day = new Date(from.getTime() + addDays * 86_400_000);
    const localWeekday = new Date(
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(day) + 'T12:00:00Z',
    ).getUTCDay();
    if (localWeekday !== weekday) continue;
    const at = localTimeToUtc(day, hour, minute, timezone);
    if (at.getTime() > from.getTime()) return at;
  }
  throw new Error('No matching weekday found within two weeks');
}

/** Today at a local time in the household's zone. */
function todayAt(hour: number, minute: number, now: Date, timezone: string): Date {
  return localTimeToUtc(now, hour, minute, timezone);
}

export interface ScenarioOptions {
  /** Injectable for tests. */
  now?: Date;
  /**
   * Whether Renee has already claimed the ride. The video claims it live on camera,
   * so the opening state leaves it unowned.
   */
  rideClaimedByRenee?: boolean;
}

/**
 * Reset the demo household to the state the video opens on:
 *
 * - Margaret logged her morning heart pill at 08:10, and her thyroid tablet.
 * - Her evening dose has no record yet — the UNCONFIRMED gap, phrased as missing.
 * - Cardiology is on the next Thursday at 10:00, recorded by Renee.
 * - The ride it implies has been confirmed as needed and has no owner.
 * - The prescription pickup is open and unowned.
 * - Renee left a note about the phone call.
 */
export async function seedScenario(
  store: CareStore, householdId: string, options: ScenarioOptions = {},
): Promise<{ cardiologyAt: Date; rideObligationId: string }> {
  const now = options.now ?? new Date();
  const cardiologyAt = nextWeekdayAt(4, 10, 0, now, NY); // 4 = Thursday

  // Morning medications, confirmed by Margaret herself.
  await store.appendEvent({
    householdId, kind: 'medication_taken', reportedBy: 'm_margaret',
    occurredAt: todayAt(8, 10, now, NY).toISOString(),
    data: { medicationId: 'med_heart', medicationName: 'heart pill', aboutMemberId: 'm_margaret' },
  });
  await store.appendEvent({
    householdId, kind: 'medication_taken', reportedBy: 'm_margaret',
    occurredAt: todayAt(8, 12, now, NY).toISOString(),
    data: { medicationId: 'med_thyroid', medicationName: 'thyroid tablet', aboutMemberId: 'm_margaret' },
  });
  // The evening dose is deliberately absent. Not "missed" — unrecorded.

  const appointment = await store.appendEvent({
    householdId, kind: 'appointment_scheduled', reportedBy: 'm_renee',
    occurredAt: cardiologyAt.toISOString(),
    detail: 'Cardiology, Thursday at 10',
    data: { appointmentKind: 'cardiology', forMemberId: 'm_margaret' },
  });

  const ride = await store.createObligation({
    householdId,
    what: 'Drive Mom to cardiology',
    status: 'OPEN',
    consequence: 'medical',
    // Inferred originally, then confirmed by a human — which is why it counts.
    provenance: { kind: 'INFERRED', rule: 'medical-appointment-transport', from: 'cardiology appointment' },
    ownerId: options.rideClaimedByRenee ? 'm_renee' : null,
    dueAt: cardiologyAt.toISOString(),
    sourceEventId: appointment.id,
  });
  if (options.rideClaimedByRenee) {
    await store.transition(ride.id, householdId, 'ASSIGNED', 'm_renee', { ownerId: 'm_renee' });
  }

  await store.createObligation({
    householdId,
    what: "Pick up Mom's prescription",
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: now.toISOString() },
    ownerId: null,
    dueAt: new Date(cardiologyAt.getTime() - 86_400_000).toISOString(),
  });

  await store.appendEvent({
    householdId, kind: 'note_added', reportedBy: 'm_renee',
    occurredAt: todayAt(14, 20, now, NY).toISOString(),
    detail: 'Mom sounded tired on the phone.',
    data: { aboutMemberId: 'm_margaret' },
  });

  return { cardiologyAt, rideObligationId: ride.id };
}
