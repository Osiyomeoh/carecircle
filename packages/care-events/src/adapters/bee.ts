/**
 * Bee → CareEvent.
 *
 * A wearable that summarises conversations produces "facts" — short statements it
 * heard, each with a confidence. To this contract a Bee fact is the *same kind of
 * thing* as a Ring doorbell: another device writing evidence into one record. That
 * is the whole point of the seam — the engine downstream cannot tell, and should
 * not care, which surface a CareEvent came from.
 *
 * A Bee fact is never a confirmed truth on its own. It enters as INFERRED, for a
 * human to confirm — the same discipline every other adapter follows.
 */
import { type CareEvent, type SignalAdapter, careEvent } from '../index.js';

/** The subset of a Bee fact this adapter reads. */
export interface BeeFact {
  /** The statement Bee derived, e.g. "needs bloodwork before Thursday". */
  text: string;
  /** 0..1 confidence Bee assigns. */
  confidence?: number;
  /** When the underlying conversation happened. */
  occurredAt?: string;
  id?: string;
}

export const beeAdapter: SignalAdapter<BeeFact> = {
  source: 'bee',
  adapt(raw: BeeFact): CareEvent[] {
    if (!raw.text?.trim()) return [];
    return [careEvent({
      ...(raw.id ? { id: `ce_bee_${raw.id}` } : {}),
      source: 'bee',
      kind: 'observation',
      ...(raw.occurredAt ? { occurredAt: raw.occurredAt } : {}),
      detail: raw.text.trim(),
      provenance: { kind: 'INFERRED', rule: 'bee:conversation-fact', from: 'bee' },
      data: { confidence: raw.confidence ?? null },
    })];
  },
};
