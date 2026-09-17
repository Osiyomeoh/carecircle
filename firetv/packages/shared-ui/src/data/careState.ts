// CareCircle live state — the SAME MCP resource the web console reads.
// This is the fourth surface: the ambient care board on the living-room TV.
// No new backend; we poll the live sim's /api/state, exactly like public/console.html.

export const CARE_API_BASE = 'https://krqi2tpsif.us-east-1.awsapprunner.com';

export type Provenance = 'CONFIRMED' | 'INFERRED' | 'NOT_LOGGED';

export interface Obligation {
  id: string;
  what: string;
  status: 'ASSIGNED' | 'PROPOSED';
  owner?: string;
  provenance: Provenance;
}

export interface Gap {
  spoken: string;
  because: string;
  kind: string;
  severity: string;
  obligationId?: string;
}

export interface Offer {
  offerId: string;
  item: string;
  merchant: string;
  etaText?: string;
  amountCents?: number;
}

export interface Notification {
  from: string;
  to: string;
  message: string;
}

export interface CareState {
  household?: { name?: string; timezone?: string; id?: string };
  members?: { id: string; name: string; role: string }[];
  obligations: Obligation[];
  gaps: Gap[];
  offers: Offer[];
  notifications: Notification[];
}

export async function fetchCareState(): Promise<CareState> {
  const res = await fetch(`${CARE_API_BASE}/api/state`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`care state ${res.status}`);
  const s = await res.json();
  return {
    household: s.household,
    members: s.members ?? [],
    obligations: s.obligations ?? [],
    gaps: s.gaps ?? [],
    offers: s.offers ?? [],
    notifications: s.notifications ?? [],
  };
}

// The provenance chip — the trust model, visible on every card.
//   CONFIRMED  a person stated it        (green)
//   INFERRED   the system guessed it     (purple) — not counted until confirmed
//   NO RECORD  nothing was logged        (amber)  — NOT "it didn't happen"
export type ChipKey = 'confirmed' | 'inferred' | 'norecord';

export const CHIP_META: Record<ChipKey, { label: string; color: string; bg: string }> = {
  confirmed: { label: 'CONFIRMED', color: '#34C759', bg: 'rgba(52,199,89,0.16)' },
  inferred: { label: 'INFERRED', color: '#BF8CFF', bg: 'rgba(150,110,255,0.18)' },
  norecord: { label: 'NO RECORD', color: '#FFB020', bg: 'rgba(255,176,32,0.16)' },
};

export function provKey(p?: Provenance): ChipKey {
  return p === 'INFERRED' ? 'inferred' : p === 'NOT_LOGGED' ? 'norecord' : 'confirmed';
}

// Mirror console.html: UNCONFIRMED gaps read NO RECORD; otherwise follow the
// linked obligation's provenance.
export function gapChip(gap: Gap, obById: Record<string, Obligation>): ChipKey {
  if (gap.kind === 'UNCONFIRMED') return 'norecord';
  if (gap.obligationId && obById[gap.obligationId]) return provKey(obById[gap.obligationId].provenance);
  return 'confirmed';
}
