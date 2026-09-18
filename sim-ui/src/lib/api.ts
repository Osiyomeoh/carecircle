// Thin client over the sim server's real endpoints (src/sim/app.ts).

export type Provenance = 'CONFIRMED' | 'INFERRED' | 'NOT_LOGGED';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

/** The score's derivation: score = round(cost * pDrop * confidence * 100). */
export interface GapFactors {
  cost: number;
  pDrop: number;
  confidence: number;
}
export interface Gap {
  spoken: string;
  because: string;
  kind: string;
  severity: Severity;
  obligationId?: string;
  score?: number;
  factors?: GapFactors;
}
export interface Obligation {
  id: string;
  what: string;
  status: 'PROPOSED' | 'ASSIGNED' | 'RESOLVED' | 'DISMISSED';
  owner?: string;
  provenance: Provenance;
}
export interface Offer {
  offerId: string;
  item: string;
  merchant: string;
  etaText: string;
  amountCents: number;
}
export interface Notification { from: string; to: string; message: string; }

export interface BoardState {
  gaps?: Gap[];
  obligations?: Obligation[];
  offers?: Offer[];
  notifications?: Notification[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
  ms: number;
}
/** A word the server mapped back onto a name this household actually uses. */
export interface Correction { from: string; to: string }

export interface Turn {
  spoken: string;
  toolCalls: ToolCall[];
  /** The transcript after correction, present only when something was changed. */
  heard?: string;
  corrections?: Correction[];
}

export interface SimConfig { provider: string; region: string; modelId: string; endpoint: string; }

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  return data;
}

export const api = {
  state: (): Promise<BoardState> => fetch('/api/state').then((r) => r.json()),
  config: (): Promise<SimConfig> => fetch('/api/config').then((r) => r.json()),
  say: (memberId: string, text: string): Promise<Turn> =>
    fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId, text }),
    }).then(jsonOrThrow),
  act: (memberId: string, tool: string, args: Record<string, unknown>): Promise<ToolCall> =>
    fetch('/api/act', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId, tool, args }),
    }).then(jsonOrThrow),
};

export interface Member { id: string; label: string; sub: string; }
export const MEMBERS: Member[] = [
  { id: 'm_margaret', label: 'Margaret', sub: 'kitchen Echo · voice-first' },
  { id: 'm_david', label: 'David', sub: 'primary caregiver · phone' },
  { id: 'm_renee', label: 'Renee', sub: 'caregiver · sister' },
  { id: 'm_aide', label: 'Tasha', sub: 'paid aide · shift only' },
];
