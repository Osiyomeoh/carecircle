import { useBoard } from '../lib/useBoard';
import { ProvChip, provFromGap } from '../components/ProvChip';
import type { GapFactors, Provenance } from '../lib/api';

const SEV_BORDER: Record<string, string> = {
  HIGH: 'border-l-sevHigh', MEDIUM: 'border-l-sevMed', LOW: 'border-l-sevLow',
};

export default function TVBoard() {
  const { state, online } = useBoard();
  const gaps = state?.gaps ?? [];
  const obById = Object.fromEntries((state?.obligations ?? []).map((o) => [o.id, o]));
  const proposals = (state?.obligations ?? []).filter((o) => o.status === 'PROPOSED');
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED');
  const empty = !proposals.length && !gaps.length && !owned.length;

  return (
    <div className="flex h-screen flex-col gap-7 bg-[radial-gradient(120%_100%_at_80%_0%,#0d1424_0%,#07090f_60%)] p-10 md:p-14">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="h-4 w-4 rounded-full bg-confirmed shadow-[0_0_22px_#7cf0c8]" />
          <div>
            <h1 className="text-3xl font-semibold md:text-4xl">Margaret's care circle</h1>
            <div className="text-base tracking-[0.04em] text-muted md:text-lg">THE SHARED CARE BOARD</div>
          </div>
        </div>
        <div className="flex items-center gap-3.5 text-lg text-muted md:text-xl">
          <span className={`h-3 w-3 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`} />
          {online ? <span><b className="text-ink">{gaps.length}</b> open · <b className="text-ink">{owned.length}</b> owned</span> : 'care board offline'}
        </div>
      </header>

      <div className="grid flex-1 content-start gap-5 overflow-hidden md:grid-cols-2 xl:grid-cols-3">
        {empty && (
          <div className="col-span-full flex h-full flex-col items-center justify-center gap-3 text-muted">
            <div className="text-3xl text-ink">Nothing outstanding.</div>
            <div>Everything recorded has an owner.</div>
          </div>
        )}

        {proposals.map((p) => (
          <Card key={p.id} border="border-l-inferred" pill="proposed">
            <div className="text-2xl font-semibold leading-snug">{p.what}</div>
            <div className="mt-3 text-lg leading-snug text-[#c3cad9]">Inferred by the system - not treated as real work until a person confirms it.</div>
            <div className="mt-4"><ProvChip kind="INFERRED" /></div>
          </Card>
        ))}

        {gaps.map((g, i) => {
          const key: Provenance = provFromGap(g.kind, g.obligationId ? obById[g.obligationId]?.provenance : undefined);
          return (
            <Card key={i} border={SEV_BORDER[g.severity] ?? 'border-l-muted'} pill={g.kind}>
              <div className="text-2xl font-semibold leading-snug">{g.spoken}</div>
              <div className="mt-3 text-lg leading-snug text-[#c3cad9]">{g.because}</div>
              {g.factors && <ScoreMath factors={g.factors} score={g.score} />}
              <div className="mt-4"><ProvChip kind={key} /></div>
            </Card>
          );
        })}

        {owned.map((o) => (
          <Card key={o.id} border="border-l-confirmed" pill="claimed">
            <div className="text-2xl font-semibold leading-snug">{o.what}</div>
            <div className="mt-3 text-lg text-[#c3cad9]"><b className="text-confirmed">{o.owner ?? 'someone'}</b> has this.</div>
            <div className="mt-4"><ProvChip kind={o.provenance} /></div>
          </Card>
        ))}
      </div>

      <footer className="flex flex-wrap gap-7 border-t border-line pt-5 text-base text-muted md:text-lg">
        <Legend color="bg-confirmed" text="Confirmed - a person stated it" />
        <Legend color="bg-inferred" text="Inferred - the system guessed, awaiting confirmation" />
        <Legend color="bg-norecord" text="No record - not the same as it not happening" />
      </footer>
    </div>
  );
}

function Card({ children, border, pill }: { children: React.ReactNode; border: string; pill: string }) {
  return (
    <div className={`glass animate-rise rounded-2xl border-l-[6px] p-6 md:p-7 ${border}`}>
      <div className="float-right rounded-full border border-line px-3 py-1.5 text-[13px] uppercase tracking-wider text-muted">{pill}</div>
      {children}
    </div>
  );
}
function Legend({ color, text }: { color: string; text: string }) {
  return <span className="flex items-center gap-2.5"><span className={`h-3 w-3 rounded-full ${color}`} />{text}</span>;
}

/**
 * The score, shown as its own derivation. Severity is not a verdict handed down -
 * it is expected harm = cost x drop-risk x confidence, and the card shows the work.
 */
function ScoreMath({ factors, score }: { factors: GapFactors; score?: number }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const shown = score ?? Math.round(factors.cost * factors.pDrop * factors.confidence * 100);
  return (
    <div className="mt-4 rounded-xl border border-line bg-black/20 px-4 py-3">
      <div className="flex items-center justify-between text-[13px] uppercase tracking-wider text-muted">
        <span>why this ranks here</span>
        <span className="text-ink"><b>{shown}</b> risk</span>
      </div>
      <div className="mt-2 flex items-center gap-2 font-mono text-base text-[#c3cad9]">
        <Term label="harm" value={pct(factors.cost)} />
        <span className="text-muted">×</span>
        <Term label="drop-risk" value={pct(factors.pDrop)} />
        <span className="text-muted">×</span>
        <Term label="confidence" value={pct(factors.confidence)} />
      </div>
    </div>
  );
}
function Term({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className="text-ink">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
    </span>
  );
}
