/**
 * CareCircle domain model.
 *
 * The whole system is one sentence: EVENTS -> OBLIGATIONS -> OWNERSHIP.
 * Something happens, that implies work, and someone must own that work.
 * A Care Gap is the failure state of the third stage.
 */

/** Who someone is to the person being cared for. Determines authority. */
export type Role =
  | 'care_recipient'   // the person being cared for; logs their own events
  | 'primary_caregiver' // full authority, including escalation
  | 'caregiver'        // can claim, add, confirm; cannot escalate
  | 'helper';          // paid aide etc; scoped to their shift

export interface Member {
  id: string;
  householdId: string;
  name: string;
  role: Role;
  /** How the person is referred to when spoken about, e.g. "Mom", "your sister Renee". */
  spokenAs?: string;
}

/**
 * Maps an authenticated subject to the member it speaks for.
 *
 * The subject is whatever the credential asserts: a validated JWT claim value in
 * production, or an opaque token in static/demo mode. Persisting the mapping is
 * what lets a circle grow at runtime - a member added today can authenticate
 * tomorrow - instead of membership being frozen into the environment at deploy.
 */
export interface IdentityMapping {
  subject: string;
  memberId: string;
  householdId: string;
}

/**
 * How we came to believe something. This is the spine of the trust model:
 * the system must never let an inference or a silence masquerade as a fact.
 */
export type Provenance =
  /** A human asserted it. The only thing we treat as fact. */
  | { kind: 'CONFIRMED'; byMemberId: string; at: string }
  /** We have no record. NOT the same as "it did not happen". */
  | { kind: 'NOT_LOGGED'; expectedAt: string }
  /** The system guessed it, by a named rule. Must be confirmed before it counts. */
  | { kind: 'INFERRED'; rule: string; from: string };

export type EventKind =
  | 'medication_taken'
  | 'appointment_scheduled'
  | 'note_added'
  | 'obligation_resolved'
  | 'member_notified'
  /** Somebody was asked to take a piece of work on. */
  | 'owner_requested'
  /** They answered - yes or no. Both are recorded; a decline is information. */
  | 'request_answered'
  | 'external_signal'
  | 'check_in'
  | 'purchase_offered'
  | 'purchase_completed';

/**
 * The immutable record of something that happened. Events are append-only:
 * care state is a fold over this log, so history is never rewritten and
 * "who said what, when" is always answerable.
 */
export interface CareEvent {
  id: string;
  householdId: string;
  kind: EventKind;
  /** Who reported it. Attribution is never anonymous. */
  reportedBy: string;
  /** When the event actually occurred (may differ from when it was reported). */
  occurredAt: string;
  recordedAt: string;
  /** Free text as spoken, preserved verbatim for the record. */
  detail?: string;
  /** Kind-specific payload. */
  data: Record<string, unknown>;
}

export type ObligationStatus =
  /** Inferred by the system; needs human confirmation before it is real work. */
  | 'PROPOSED'
  /** Real, and nobody owns it. This is what produces a Care Gap. */
  | 'OPEN'
  /**
   * Somebody has been *asked* and has not answered yet.
   *
   * Deliberately distinct from ASSIGNED: being asked is not the same as having
   * agreed, and collapsing the two would be exactly the kind of assumption this
   * system exists to refuse. A REQUESTED obligation still has no owner and still
   * reads as a Care Gap.
   */
  | 'REQUESTED'
  /** Someone has taken it. */
  | 'ASSIGNED'
  /** Done. */
  | 'RESOLVED'
  /** A human said this isn't needed. */
  | 'DISMISSED';

/** What kind of harm follows if this is dropped. Drives gap severity. */
export type ConsequenceClass = 'medical' | 'logistical' | 'social';

/**
 * A thing that needs to happen for the person being cared for.
 * Obligations are the unit of accountability; ownership is the point.
 */
export interface Obligation {
  id: string;
  householdId: string;
  /** Spoken description, e.g. "Drive Margaret to cardiology". */
  what: string;
  status: ObligationStatus;
  consequence: ConsequenceClass;
  /** Why we believe this needs doing. Inferred obligations start as PROPOSED. */
  provenance: Provenance;
  /** Member id, or null when nobody has it. Null + OPEN = Care Gap. */
  ownerId: string | null;
  /** When it must happen by, if it is dated. */
  dueAt?: string;
  /** The event that gave rise to it, if any. */
  sourceEventId?: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
  /**
   * The outstanding ask, when status is REQUESTED. `ownerId` stays null while this
   * is set - the request is a question, not a transfer.
   */
  request?: {
    askedOfId: string;
    askedById: string;
    askedAt: string;
  };
  /**
   * Everyone who has said no to this particular piece of work. Kept so the agent
   * moves down the circle instead of asking the same person twice, and so a decline
   * stays visible rather than evaporating.
   */
  declinedBy?: string[];
}

export type GapKind =
  /** An obligation exists and nobody owns it. */
  | 'UNCLAIMED'
  /** We expected a record and do not have one. Never stated as "did not happen". */
  | 'UNCONFIRMED'
  /** Partially handled, or handled long enough ago to be stale. */
  | 'NEEDS_FOLLOW_UP';

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A Care Gap: something important is known to need attention, and nobody owns it.
 *
 * Computed deterministically by the engine, never narrated by a model. The model's
 * only job is to speak `spoken`.
 */
export interface CareGap {
  id: string;
  kind: GapKind;
  severity: Severity;
  /** One sentence, ready to be read aloud with no reformatting. */
  spoken: string;
  /** Why the engine flagged this, in plain language. Shown, not inferred. */
  because: string;
  obligationId?: string;
  dueAt?: string;
  /** Ranking score; higher sorts first. Exposed so the ordering is auditable. */
  score: number;
  /**
   * The score's derivation: score = round(cost * pDrop * confidence * 100). Each
   * term is in [0,1]. Exposed so the UI can show *why* a gap ranks where it does -
   * the number explains itself instead of being an opaque verdict.
   */
  factors: {
    /** Normalized harm magnitude if dropped (medical 1.0, logistical 0.5, social 0.2). */
    cost: number;
    /** Probability the work is dropped, from deadline/aging hazards. */
    pDrop: number;
    /** Confidence the gap is real (CONFIRMED 1.0, NOT_LOGGED 0.75, INFERRED 0.6). */
    confidence: number;
  };
}

/** A medication the household expects to be taken on a schedule. */
export interface MedicationSchedule {
  id: string;
  householdId: string;
  name: string;
  /** Local times of day, "HH:MM", when a dose is expected. */
  times: string[];
  forMemberId: string;
}

export interface Household {
  id: string;
  name: string;
  /** IANA zone; all schedule reasoning happens in the household's local time. */
  timezone: string;
}

/** Everything the gap engine needs. A pure input, so the engine stays testable. */
export interface CareState {
  household: Household;
  members: Member[];
  events: CareEvent[];
  obligations: Obligation[];
  medications: MedicationSchedule[];
}
