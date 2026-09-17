// Thin client over the sim server's real endpoints (src/sim/app.ts).

export type Provenance = 'CONFIRMED' | 'INFERRED' | 'NOT_LOGGED';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Gap {
  spoken: string;
  because: string;
  kind: string;
  severity: Severity;
  obligationId?: string;
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
export interface Turn { spoken: string; toolCalls: ToolCall[]; }

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
