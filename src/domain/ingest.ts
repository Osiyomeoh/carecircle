import type { CareStore } from '../store/store.js';
import { interpretSignal, type CareSignal } from './signals.js';

/**
 * Applying a device signal to the care record.
 *
 * Shared by the `ingest_signal` tool and the Ring webhook so that a doorbell and a
 * person describing a doorbell travel exactly the same path. If they diverged, the
 * webhook would become a second, weaker way into the same state - and the whole
 * argument of this system is that evidence is treated by what it is, not by which
 * door it arrived through.
 */

export interface IngestResult {
  eventId: string;
  /** An obligation this signal proposed, if any. Always PROPOSED, never real work. */
  proposalId: string | null;
  /** Open work this is evidence toward. Named, never resolved automatically. */
  resolvesCandidate: string | null;
  /** One line, ready to speak. */
  spoken: string;
  /** The question to put to a human, when the signal raises one. */
  ask: string | null;
}

export async function applySignal(
  store: CareStore,
  householdId: string,
  signal: CareSignal,
  now: Date,
): Promise<IngestResult> {
  const state = store.getCareState(householdId);
  const recipient = state.members.find((m) => m.role === 'care_recipient');
  if (!recipient) throw new Error('This household has no care recipient.');

  const outcome = interpretSignal(signal, {
    recipientId: recipient.id,
    recipientName: recipient.spokenAs ?? recipient.name,
    now,
  });

  const event = await store.appendEvent({ ...outcome.event, householdId });

  // Name the work this is evidence toward; do not touch it. A sensor never closes
  // a medical obligation.
  let resolvesCandidate: string | null = null;
  if (outcome.resolvesObligationLike) {
    const needle = outcome.resolvesObligationLike.match.toLowerCase();
    const open = state.obligations.find(
      (o) => o.what.toLowerCase().includes(needle)
        && o.status !== 'RESOLVED' && o.status !== 'DISMISSED',
    );
    resolvesCandidate = open?.id ?? null;
  }

  let proposalId: string | null = null;
  if (outcome.proposeObligation) {
    const created = await store.createObligation({
      householdId,
      what: outcome.proposeObligation.what,
      status: 'PROPOSED',
      consequence: outcome.proposeObligation.consequence,
      provenance: {
        kind: 'INFERRED',
        rule: `signal:${signal.source}:${signal.kind}`,
        from: `${signal.source} ${signal.kind}`,
      },
      ownerId: null,
      sourceEventId: event.id,
    });
    proposalId = created.id;
  }

  const ask = outcome.resolvesObligationLike?.ask ?? outcome.proposeObligation?.ask ?? null;
  return { eventId: event.id, proposalId, resolvesCandidate, spoken: outcome.spoken, ask };
}
