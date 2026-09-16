/**
 * @carecircle/care-events
 *
 * One seam that any device can plug into.
 *
 * A care signal can come from anywhere — a spoken sentence, a wearable's summary of
 * a conversation, a doorbell that saw a delivery. This package defines the single
 * contract they all become, so a coordination system can treat them uniformly:
 *
 *     raw device payload  --(adapter)-->  CareEvent  -->  your engine
 *
 * The one rule the contract enforces is the important one: a signal is EVIDENCE,
 * never a conclusion. Its provenance says how much to trust it, and an inference or
 * an absence is never allowed to masquerade as a confirmed fact. Adapters classify;
 * they never assert.
 *
 * Zero dependencies. Bring your own transport and your own engine.
 */

/** How we came to believe something — the spine of the trust model. */
export type Provenance =
  /** A human asserted it. The only thing to treat as fact. */
  | { kind: 'CONFIRMED'; by: string; at: string }
  /** A device or model inferred it, by a named rule. Confirm before acting. */
  | { kind: 'INFERRED'; rule: string; from: string }
  /** There is no record. NOT the same as "it did not happen". */
  | { kind: 'NOT_LOGGED'; expectedAt: string };

/** What a signal is about, coarse enough to be shared across device types. */
export type CareEventKind =
  | 'medication'      // a dose was reported taken
  | 'appointment'     // a future commitment
  | 'observation'     // a note, a mood, a symptom
  | 'delivery'        // something arrived
  | 'presence'        // activity, or its absence, at a place
  | 'message';        // a person told another person something

/** The uniform shape every device's signal becomes. */
export interface CareEvent {
  /** Stable id for de-duplication across redeliveries. */
  id: string;
  kind: CareEventKind;
  /** Which surface produced it: 'alexa', 'ring', 'bee', 'manual', … */
  source: string;
  /** ISO 8601 time the thing happened (not when it was received). */
  occurredAt: string;
  /** Human-readable, kept verbatim from the device where possible. */
  detail?: string;
  /** How much to trust it. Adapters must set this honestly. */
  provenance: Provenance;
  /** Source-specific structured data, untouched. */
  data?: Record<string, unknown>;
}

/**
 * An adapter turns one device's raw payload into zero or more CareEvents.
 *
 * Returning an empty array is a first-class outcome: a doorbell ring that is not a
 * delivery, a wearable utterance that carries no obligation. An adapter that is
 * unsure emits an INFERRED event for a human to confirm — it does not drop the
 * signal, and it does not upgrade a guess to a fact.
 */
export interface SignalAdapter<Raw> {
  readonly source: string;
  adapt(raw: Raw): CareEvent[];
}

let counter = 0;
/** A stable-enough id without pulling in a uuid dependency. */
export function eventId(source: string, seed?: string): string {
  counter += 1;
  const base = seed ?? `${Date.now()}-${counter}`;
  return `ce_${source}_${base}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Convenience builder that fills an id and defaults occurredAt to now. */
export function careEvent(
  e: Omit<CareEvent, 'id' | 'occurredAt'> & Partial<Pick<CareEvent, 'id' | 'occurredAt'>>,
): CareEvent {
  return {
    id: e.id ?? eventId(e.source),
    occurredAt: e.occurredAt ?? new Date().toISOString(),
    kind: e.kind,
    source: e.source,
    provenance: e.provenance,
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.data ? { data: e.data } : {}),
  };
}

export * from './adapters/ring.js';
export * from './adapters/bee.js';
