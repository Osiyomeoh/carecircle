/**
 * The purchase moment.
 *
 * Some Care Gaps are closed not by a person doing the task but by buying the thing:
 * a prescription that needs reordering. CareCircle turns that into an OFFER — priced,
 * sourced, with an ETA — that a human confirms in place. It never charges on its own:
 * a purchase follows the same discipline as everything else here, Known != Assumed.
 * The offer is a proposal; only a confirmation makes it real.
 *
 * These are simulated storefronts for the hackathon — no real payment is taken. The
 * shape is exactly what a real MCP commerce integration would return, so the seam is
 * honest about what it is and ready for a real merchant behind it. Adding a second
 * purchase kind (e.g. a paid medical ride) is a new OfferKind and one branch here.
 */

export type OfferKind = 'prescription_refill';

export interface PurchaseOffer {
  offerId: string;
  kind: OfferKind;
  /** What is being bought, in plain words. */
  item: string;
  merchant: string;
  amountCents: number;
  currency: 'USD';
  /** When it lands, phrased for speech. */
  etaText: string;
  /** The Care Gap this purchase would close, if any. */
  obligationId?: string;
  /** Always true here: no real card is charged. */
  simulated: true;
}

export function formatPrice(amountCents: number, currency: 'USD' = 'USD'): string {
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${(amountCents / 100).toFixed(2)}`;
}

interface OfferContext {
  offerId: string;
  /** The medication or item name, when reordering. */
  itemName?: string;
  obligationId?: string;
}

/**
 * Build a priced offer. Deterministic so the demo — and the tests — see the same
 * numbers every time. A real integration swaps this for a live catalogue lookup
 * behind the same return type.
 */
export function offerFor(kind: OfferKind, ctx: OfferContext): PurchaseOffer {
  const item = ctx.itemName ? `${ctx.itemName} refill — 30-day supply` : 'Prescription refill — 30-day supply';
  return {
    offerId: ctx.offerId, kind, item,
    merchant: 'Cornerside Pharmacy',
    amountCents: 1200, currency: 'USD',
    etaText: 'delivered to the door by tomorrow evening',
    simulated: true,
    ...(ctx.obligationId ? { obligationId: ctx.obligationId } : {}),
  };
}

/** The single sentence the assistant speaks when it presents an offer. */
export function offerSpoken(offer: PurchaseOffer): string {
  return `${offer.item} from ${offer.merchant} is ${formatPrice(offer.amountCents, offer.currency)}, `
    + `${offer.etaText}. Want me to place it? Nothing is charged until you confirm.`;
}
