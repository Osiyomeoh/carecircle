import type { CareEvent, CareGap, ConsequenceClass, Obligation } from './types.js';

/**
 * Physical-world signals as a care-event source.
 *
 * CareCircle's premise is that obligations come loose in the real world and nobody
 * notices. A Ring event is the real world noticing on the family's behalf: a
 * delivery that physically arrived, a door that did or did not open. No one typed
 * anything - which is exactly the point.
 *
 * Two rules of the wider system still hold, and shape everything here:
 *
 *  - A signal is EVIDENCE, not a verdict. "The pharmacy delivery arrived at the
 *    door" is grounds to propose that the prescription pickup is done; a human
 *    confirms it. The system never closes a medical obligation on a sensor alone.
 *  - Absence is reported as absence. "No activity recorded at the door today" is a
 *    reason to check in, never a claim that something is wrong. Known != Assumed.
 *
 * A Ring integration is therefore not a new product - it is another way an
 * INFERRED proposal enters the same pipeline, no different in kind from inferring
 * a ride from an appointment. That is what lets it be added without touching the
 * gap engine or the trust model.
 */

/** A signal observed by a device, normalised away from any one vendor's shape. */
export interface CareSignal {
  source: 'ring' | 'other';
  kind: 'delivery_arrived' | 'door_activity' | 'motion' | 'no_activity';
  /** When it was observed. */
  at: string;
  /** Free description as the device reported it, kept for the record. */
  detail?: string;
  /** Vendor payload, e.g. a Ring event id, for traceability. */
  raw?: Record<string, unknown>;
}

/** Something a signal suggests the family might act on - always as a proposal. */
export interface SignalOutcome {
  /** A care event to record: the signal happened, attributed to the device. */
  event: Omit<CareEvent, 'id' | 'recordedAt'>;
  /**
   * An obligation this signal proposes creating, if any - e.g. "check on Mom".
   * Enters PROPOSED, like every inference.
   */
  proposeObligation?: {
    what: string;
    consequence: ConsequenceClass;
    ask: string;
  };
  /**
   * An existing obligation this signal is evidence toward resolving, if any.
   * Never resolved automatically - the caller asks a human.
   */
  resolvesObligationLike?: {
    /** Substring to match against open obligations, e.g. "prescription". */
    match: string;
    ask: string;
  };
  /** One line, ready to be spoken. */
  spoken: string;
}

const HOUR = 3_600_000;

/**
 * Interpret a signal into care semantics.
 *
 * Pure: given a signal and the local clock, it returns what the signal means,
 * without touching any store. That keeps the physical-world reasoning as testable
 * as the rest of the engine.
 */
export function interpretSignal(
  signal: CareSignal,
  context: { recipientId: string; recipientName: string; now: Date },
): SignalOutcome {
  const baseEvent = {
    householdId: '', // filled by the caller, which knows the household
    kind: 'external_signal' as const,
    reportedBy: `device:${signal.source}`,
    occurredAt: signal.at,
    ...(signal.detail ? { detail: signal.detail } : {}),
    data: { source: signal.source, signalKind: signal.kind, ...(signal.raw ? { raw: signal.raw } : {}) },
  };

  switch (signal.kind) {
    case 'delivery_arrived': {
      // Evidence toward a pickup/delivery obligation. Propose resolution; ask.
      return {
        event: baseEvent,
        resolvesObligationLike: {
          match: 'prescription',
          ask: `A delivery arrived at ${context.recipientName}'s door. Was that the prescription - should I mark it picked up?`,
        },
        spoken: `A delivery just arrived at ${context.recipientName}'s door.`,
      };
    }
    case 'door_activity':
    case 'motion': {
      // A sign of life. Recorded, not acted on - it clears a "no activity" worry
      // simply by existing in the log.
      return {
        event: baseEvent,
        spoken: `There's been activity at ${context.recipientName}'s door.`,
      };
    }
    case 'no_activity': {
      // The inverse beat: an obligation CREATED by an absence. Phrased as absence,
      // never as alarm - the family decides whether it matters.
      return {
        event: baseEvent,
        proposeObligation: {
          what: `Check in on ${context.recipientName}`,
          consequence: 'medical',
          ask: `There's been no activity at ${context.recipientName}'s door today, and nothing logged. `
            + `I don't know that anything is wrong - do you want someone to check in?`,
        },
        spoken: `No activity at ${context.recipientName}'s door has been recorded today.`,
      };
    }
  }
}

/**
 * Whether a "no activity" concern is even warranted yet.
 *
 * Only after a reasonable part of the day has passed with no recorded signal - so
 * the system does not raise a check-in at 8am because nobody has opened the door
 * at dawn. Mirrors the medication grace period: absence is only notable once
 * presence was genuinely expected.
 */
export function noActivityWarranted(
  signals: CareEvent[],
  now: Date,
  timezone: string,
  afterLocalHour = 14,
): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const today = `${parts['year']}-${parts['month']}-${parts['day']}`;
  const localHour = Number(parts['hour']) % 24;
  if (localHour < afterLocalHour) return false;

  const hadActivityToday = signals.some((e) => {
    if (e.kind !== 'external_signal') return false;
    const k = e.data['signalKind'];
    if (k !== 'door_activity' && k !== 'motion' && k !== 'delivery_arrived') return false;
    const d = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(e.occurredAt));
    return d === today;
  });
  return !hadActivityToday;
}
