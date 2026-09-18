import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { applySignal } from '../domain/ingest.js';
import { ringEventToSignal, ringIdempotencyKey, type RingEvent } from '../domain/ring.js';
import type { CareStore } from '../store/store.js';

/**
 * The Ring webhook.
 *
 * Ring POSTs an event, signs it HMAC-SHA256 with the partner signing key in an
 * `X-Signature` header, guarantees `meta.request_id` for idempotency, and expects
 * HTTP 200 within five seconds.
 *
 * Three things this endpoint refuses to do, all of them load-bearing:
 *
 *  - **Trust an unsigned body.** Anyone can POST to a public URL. Without signature
 *    verification a stranger could inject "a delivery arrived" into a family's
 *    medical record, so an unverifiable body is rejected before it is even parsed.
 *  - **Act twice on one event.** Webhooks redeliver. Ring provides `request_id`
 *    precisely so a retry is recognisable, and a duplicated "package arrived" is a
 *    duplicated proposal in someone's care board.
 *  - **Turn a sensor into a fact.** A Ring event becomes an INFERRED proposal down
 *    the same path as any other signal. The doorbell reports what it saw; a human
 *    decides what it meant.
 */

/** Ring's signature header. */
export const SIGNATURE_HEADER = 'x-signature';

/**
 * Constant-time comparison of a signature against the body.
 *
 * `timingSafeEqual` throws on a length mismatch, and comparing with `===` would
 * leak how much of a forged signature was correct, so both are handled here.
 */
export function verifySignature(rawBody: Buffer, signature: string | undefined, key: string): boolean {
  if (!signature || !key) return false;
  const expected = createHmac('sha256', key).update(rawBody).digest('hex');
  // Ring sends hex; tolerate a `sha256=` prefix, which several partner APIs use.
  const given = signature.trim().replace(/^sha256=/i, '').toLowerCase();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Remembers which events have already been applied.
 *
 * Bounded on purpose: an unbounded set on a public endpoint is a way to be run out
 * of memory by whoever cares to try.
 */
export class SeenEvents {
  readonly #seen = new Set<string>();
  readonly #order: string[] = [];
  readonly #limit: number;

  constructor(limit = 5_000) { this.#limit = limit; }

  /** True the first time a key is offered, false on every repeat. */
  admit(key: string): boolean {
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    this.#order.push(key);
    if (this.#order.length > this.#limit) {
      const oldest = this.#order.shift();
      if (oldest) this.#seen.delete(oldest);
    }
    return true;
  }
}

export interface RingWebhookOptions {
  store: CareStore;
  /** The partner HMAC signing key. Without it the endpoint refuses everything. */
  hmacKey: string;
  /** Which household this Ring account belongs to. */
  householdId: string;
  seen?: SeenEvents;
  now?: () => Date;
}

export function createRingWebhook(opts: RingWebhookOptions) {
  const seen = opts.seen ?? new SeenEvents();
  const now = opts.now ?? (() => new Date());

  return async function handle(req: Request, res: Response): Promise<void> {
    const raw: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from((req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));

    if (!opts.hmacKey) {
      // Better to go dark than to accept unverifiable claims about someone's home.
      res.status(503).json({ error: 'Ring integration is not configured.' });
      return;
    }
    const signature = req.header(SIGNATURE_HEADER) ?? undefined;
    if (!verifySignature(raw, signature, opts.hmacKey)) {
      res.status(401).json({ error: 'Bad signature.' });
      return;
    }

    let event: RingEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as RingEvent;
    } catch {
      res.status(400).json({ error: 'Body was not JSON.' });
      return;
    }

    // Ring retries anything that is not a 200, so an event we cannot act on must
    // still be acknowledged - otherwise it is redelivered forever.
    const key = ringIdempotencyKey(event);
    if (key && !seen.admit(key)) {
      res.status(200).json({ status: 'duplicate', requestId: key });
      return;
    }

    const signal = ringEventToSignal(event);
    if (!signal) {
      res.status(200).json({ status: 'ignored', type: event.data?.type ?? null });
      return;
    }

    try {
      const result = await applySignal(opts.store, opts.householdId, signal, now());
      res.status(200).json({
        status: 'accepted',
        kind: signal.kind,
        eventId: result.eventId,
        // Named so the response shows what it did and did NOT do: it proposed.
        proposalId: result.proposalId,
        resolvesCandidate: result.resolvesCandidate,
        spoken: result.spoken,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };
}
