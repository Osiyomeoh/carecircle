import type { Provenance } from '../lib/api';

const MAP: Record<Provenance, { cls: string; label: string; title: string }> = {
  CONFIRMED: { cls: 'bg-confirmed', label: 'Confirmed', title: 'A person stated this.' },
  INFERRED: { cls: 'bg-inferred', label: 'Inferred', title: 'The system guessed this — not counted until someone confirms.' },
  NOT_LOGGED: { cls: 'bg-norecord', label: 'No record', title: 'Nothing was logged. This is not the same as it not happening.' },
};

export function ProvChip({ kind }: { kind: Provenance }) {
  const p = MAP[kind];
  return (
    <span className="prov" title={p.title}>
      <span className={`prov-dot ${p.cls}`} />
      {p.label}
    </span>
  );
}

export function provFromGap(kind: string, gapProvenance?: Provenance): Provenance {
  if (kind === 'UNCONFIRMED') return 'NOT_LOGGED';
  return gapProvenance ?? 'CONFIRMED';
}
