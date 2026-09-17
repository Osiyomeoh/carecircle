/**
 * Ring → CareEvent.
 *
 * Modelled against Ring's real webhook envelope. The important discipline is here:
 * a delivery becomes EVIDENCE that a package arrived, never a conclusion that the
 * prescription was picked up. No activity becomes a presence event with an INFERRED
 * provenance - grounds to ASK whether someone should check in, never a claim that
 * anything is wrong.
 */
import { type CareEvent, type SignalAdapter, careEvent } from '../index.js';

/** The subset of a Ring webhook event this adapter reads. */
export interface RingWebhookEvent {
  /** Ring event type, e.g. 'motion_detected', 'ding'. */
  type: string;
  /** Ring's sub-classification, e.g. 'package_delivery', 'human'. */
  sub_type?: string;
  device_id?: string;
  created_at?: string;
  /** Ring's idempotency key; prefer it so a redelivered webhook is not double-counted. */
  request_id?: string;
}

export const ringAdapter: SignalAdapter<RingWebhookEvent> = {
  source: 'ring',
  adapt(raw: RingWebhookEvent): CareEvent[] {
    const at = raw.created_at ?? new Date().toISOString();
    const id = raw.request_id ? `ce_ring_${raw.request_id}` : undefined;
    const seed = raw.sub_type ?? raw.type;

    const isDelivery = raw.type === 'motion_detected' && raw.sub_type === 'package_delivery';
    if (isDelivery) {
      return [careEvent({
        ...(id ? { id } : {}), source: 'ring', kind: 'delivery', occurredAt: at,
        detail: 'A package arrived at the door.',
        // Evidence toward an errand, not proof it is done.
        provenance: { kind: 'INFERRED', rule: 'ring:package_delivery', from: seed },
        data: { deviceId: raw.device_id },
      })];
    }

    if (raw.type === 'motion_detected' || raw.type === 'ding') {
      return [careEvent({
        ...(id ? { id } : {}), source: 'ring', kind: 'presence', occurredAt: at,
        detail: 'Activity at the door.',
        provenance: { kind: 'INFERRED', rule: `ring:${raw.type}`, from: seed },
        data: { deviceId: raw.device_id },
      })];
    }

    // Unknown event types are ignored, never mismapped.
    return [];
  },
};
