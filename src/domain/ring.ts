import type { CareSignal } from './signals.js';

/**
 * Adapter: a real Ring webhook event -> a vendor-neutral CareSignal.
 *
 * Modelled on Ring's published Partner API event contract (JSON:API format,
 * HMAC-SHA256 X-Signature, `request_id` for idempotency). Ring emits *presence*
 * events - motion, a button press - never absence. "No one has been to the door
 * all day" is therefore not a Ring event: it is an inference CareCircle draws over
 * the absence of these events (see noActivityWarranted in signals.ts). Keeping that
 * distinction honest matters - the doorbell reports what it saw, and the system is
 * responsible for what it did not.
 *
 * The exact field nesting is not fully published (see docs/FRICTION-LOG.md), so the
 * reader is defensive: it takes what the documented contract guarantees - a type, a
 * device, a timestamp, a motion sub_type - and ignores the rest.
 */

/** The subset of a Ring webhook event this adapter relies on. */
export interface RingEvent {
  data?: {
    type?: string;
    id?: string;
    attributes?: {
      created_at?: string;
      sub_type?: string;
      [k: string]: unknown;
    };
    relationships?: { device?: { data?: { id?: string } } };
  };
  meta?: { request_id?: string; account_id?: string };
}

/**
 * Map a Ring event to a CareSignal, or null when the event is not one CareCircle
 * acts on (a device coming online, a subscription change).
 *
 * A package/delivery detection is a `motion_detected` with a package sub_type -
 * Ring does not have a distinct "delivery" event, so we read it from the sub_type
 * rather than inventing an event that does not exist.
 */
export function ringEventToSignal(event: RingEvent): CareSignal | null {
  const type = event.data?.type;
  const at = event.data?.attributes?.created_at ?? new Date().toISOString();
  const subType = event.data?.attributes?.sub_type?.toLowerCase();
  const raw: Record<string, unknown> = {
    ...(event.data?.id ? { ringEventId: event.data.id } : {}),
    ...(event.data?.relationships?.device?.data?.id ? { deviceId: event.data.relationships.device.data.id } : {}),
    ...(event.meta?.request_id ? { requestId: event.meta.request_id } : {}),
    ...(type ? { ringType: type } : {}),
    ...(subType ? { subType } : {}),
  };

  switch (type) {
    case 'motion_detected':
      // A package/delivery sub_type is evidence toward a pickup; other motion is
      // simply a sign of life at the door.
      if (subType && /package|delivery/.test(subType)) {
        return { source: 'ring', kind: 'delivery_arrived', at, detail: 'Package detected at the door', raw };
      }
      return { source: 'ring', kind: 'motion', at, detail: `Motion detected${subType ? ` (${subType})` : ''}`, raw };
    case 'button_press':
      return { source: 'ring', kind: 'door_activity', at, detail: 'Someone pressed the doorbell', raw };
    default:
      // device_online, subscription_activated, etc. - not care-relevant.
      return null;
  }
}

/**
 * The idempotency key for a Ring event, so a webhook redelivery is not recorded
 * twice. Ring guarantees `request_id` in event metadata for exactly this.
 */
export function ringIdempotencyKey(event: RingEvent): string | null {
  return event.meta?.request_id ?? event.data?.id ?? null;
}
