/**
 * Turning what somebody said into an instant.
 *
 * A voice assistant hears "Thursday at ten". Something has to turn that into a
 * timestamp, and that something is a language model - which is exactly the part
 * of the system least equipped to know what day it is. Left to itself a planner
 * will confidently emit a date from its own training prior, with no timezone,
 * and the family gets an appointment in a year that has already happened.
 *
 * So two defences live here:
 *  - a wall-clock time with no offset is read in the household's zone, not UTC;
 *  - a date implausibly far from now is refused rather than recorded, because a
 *    silently wrong appointment date is worse than a question.
 */

/** How far ahead of UTC `timezone` is at this instant, in milliseconds. */
function zoneOffsetMs(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(
    Number(p['year']), Number(p['month']) - 1, Number(p['day']),
    Number(p['hour']) % 24, Number(p['minute']), Number(p['second']),
  );
  return asUTC - at.getTime();
}

/** Whether a timestamp already says which offset it is in. */
export function hasOffset(iso: string): boolean {
  return /([Zz]|[+-]\d{2}:?\d{2})$/.test(iso.trim());
}

/**
 * Normalise a spoken-origin timestamp to a real instant.
 *
 * "2026-09-24T10:00:00" in a New York household means 10am in New York, not 10am
 * UTC. Reading it as UTC silently moves every appointment by the offset, which is
 * the kind of error nobody notices until somebody misses a cardiology slot.
 */
export function toInstant(iso: string, timezone: string): string | null {
  const raw = iso.trim();
  if (!raw) return null;
  if (hasOffset(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const provisional = new Date(`${raw}Z`);
  if (Number.isNaN(provisional.getTime())) return null;
  // Offset is evaluated at the provisional instant, which is within a day of the
  // real one - close enough that it only differs across a DST boundary.
  const offset = zoneOffsetMs(provisional, timezone);
  return new Date(provisional.getTime() - offset).toISOString();
}

/** How far outside the plausible window a date is, if it is. */
export type Implausible = { reason: 'too-far-past' | 'too-far-future'; spoken: string };

const PAST_GRACE_DAYS = 2;
const FUTURE_LIMIT_DAYS = 400;

/**
 * Catch a date the planner invented.
 *
 * Appointments are scheduled ahead, occasionally recorded a day or two late, and
 * effectively never set years in the past. A timestamp outside that window is far
 * more likely to be a model's guess than a family's intent, so we ask instead of
 * recording it.
 */
export function implausible(iso: string, now: Date): Implausible | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const days = (at.getTime() - now.getTime()) / 86_400_000;
  if (days < -PAST_GRACE_DAYS) {
    return {
      reason: 'too-far-past',
      spoken: 'That date has already passed, so I want to check I heard it right. '
        + 'Which day did you mean?',
    };
  }
  if (days > FUTURE_LIMIT_DAYS) {
    return {
      reason: 'too-far-future',
      spoken: "That's more than a year away, so I want to check I heard it right. "
        + 'Which day did you mean?',
    };
  }
  return null;
}
