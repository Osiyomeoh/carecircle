import { createHmac } from 'node:crypto';

/**
 * A Ring device simulator.
 *
 * Ring's own staging environment tests against real hardware, so this stands in
 * for the doorbell - and only for the doorbell. Everything downstream is the
 * production path: events are built to Ring's published Partner API contract, and
 * **signed with the real partner HMAC key**, so the server's signature
 * verification, idempotency and inference all run exactly as they do for Ring.
 *
 * What is simulated is the device. What is exercised is the integration.
 *
 *   npm run ring:simulate -- --url https://host/ring/webhook --event package
 */

export type SimEventKind = 'package' | 'motion' | 'button' | 'device_online';

export interface SimEvent {
  data: {
    type: string;
    id: string;
    attributes: { created_at: string; sub_type?: string };
    relationships: { device: { data: { id: string } } };
  };
  meta: { request_id: string; account_id: string };
}

/** Build an event in Ring's documented shape. */
export function buildEvent(
  kind: SimEventKind,
  opts: { requestId: string; deviceId?: string; at?: Date } ,
): SimEvent {
  const created_at = (opts.at ?? new Date()).toISOString();
  const device = opts.deviceId ?? 'dev_front_door';
  const type = kind === 'button' ? 'button_press'
    : kind === 'device_online' ? 'device_online'
    : 'motion_detected';
  const subType = kind === 'package' ? 'package' : kind === 'motion' ? 'human' : undefined;
  return {
    data: {
      type,
      id: `evt_${opts.requestId}`,
      attributes: { created_at, ...(subType ? { sub_type: subType } : {}) },
      relationships: { device: { data: { id: device } } },
    },
    meta: { request_id: opts.requestId, account_id: 'acct_carecircle_demo' },
  };
}

/** Sign a body exactly as Ring does: HMAC-SHA256 hex over the raw bytes. */
export function signBody(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('hex');
}

export interface DeliveryResult {
  status: number;
  body: unknown;
  requestId: string;
}

/** POST a signed event at a webhook, the way Ring would. */
export async function deliver(
  url: string, event: SimEvent, key: string,
): Promise<DeliveryResult> {
  // Sign the exact bytes that are sent - re-stringifying would change them.
  const body = JSON.stringify(event);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signBody(body, key) },
    body,
  });
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    requestId: event.meta.request_id,
  };
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const url = arg('url', process.env['RING_WEBHOOK_URL']);
  const key = process.env['RING_HMAC_KEY'] ?? '';
  const kind = (arg('event', 'package') ?? 'package') as SimEventKind;
  const repeat = Number(arg('repeat', '1'));

  if (!url) throw new Error('Pass --url, or set RING_WEBHOOK_URL.');
  if (!key) throw new Error('RING_HMAC_KEY is not set. It lives in .env, never in the repo.');

  const requestId = arg('request-id', `sim-${Date.now()}`)!;
  console.log(`Ring simulator -> ${url}`);
  console.log(`  event: ${kind}   request_id: ${requestId}`);

  for (let i = 0; i < repeat; i += 1) {
    // Deliberately the SAME request_id on a repeat, to exercise idempotency the
    // way a Ring redelivery would.
    const result = await deliver(url, buildEvent(kind, { requestId }), key);
    console.log(`  [${i + 1}/${repeat}] ${result.status} ${JSON.stringify(result.body)}`);
  }
}

// Only run when invoked directly, so the helpers stay importable by tests.
if (process.argv[1]?.includes('ring-simulate')) {
  main().catch((err) => { console.error(String(err.message ?? err)); process.exit(1); });
}
