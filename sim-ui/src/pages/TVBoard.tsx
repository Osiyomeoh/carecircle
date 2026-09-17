import { useEffect, useRef } from 'react';
import { useBoard } from '../lib/useBoard';
import { ProvChip, provFromGap } from '../components/ProvChip';
import type { Provenance } from '../lib/api';

const SEV_BORDER: Record<string, string> = {
  HIGH: 'border-l-sevHigh', MEDIUM: 'border-l-sevMed', LOW: 'border-l-sevLow',
};

/**
 * On Fire TV the WebView exposes a native bridge (AndroidBridge.notify). When the
 * most urgent gap is more than routine, raise it as a real heads-up notification so
 * it slides in over whatever is on the TV. No-op in a normal browser (no bridge).
 */
interface AndroidBridge { notify(title: string, body: string): void; }
declare global { interface Window { AndroidBridge?: AndroidBridge } }

/** Most cards that fit one no-scroll 1080p TV screen (2 rows x 3 columns). */
const TV_MAX_CARDS = 6;

export default function TVBoard() {
  const { state, online } = useBoard();
  const gaps = state?.gaps ?? [];
  const obById = Object.fromEntries((state?.obligations ?? []).map((o) => [o.id, o]));
  const proposals = (state?.obligations ?? []).filter((o) => o.status === 'PROPOSED');
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED');
  const empty = !proposals.length && !gaps.length && !owned.length;

  // A 10-foot board is glanceable, not exhaustive: lead with the unowned gaps
  // (the whole point), then the system's proposals, then what is already handled,
  // and cap to what fits one screen. The phone/console shows the full list.
  type Item =
    | { t: 'gap'; g: (typeof gaps)[number] }
    | { t: 'proposal'; o: (typeof proposals)[number] }
    | { t: 'owned'; o: (typeof owned)[number] };
  const items: Item[] = [
    ...gaps.map((g) => ({ t: 'gap' as const, g })),
    ...proposals.map((o) => ({ t: 'proposal' as const, o })),
    ...owned.map((o) => ({ t: 'owned' as const, o })),
  ];
  const shown = items.slice(0, TV_MAX_CARDS);
  const hidden = items.length - shown.length;

  // Fire a Fire TV heads-up notification for the top gap when it is not routine
  // (severity above LOW), once per distinct gap so it never spams. gaps[0] is the
  // highest-ranked by the risk model.
  const notified = useRef<Set<string>>(new Set());
  const top = gaps[0];
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.AndroidBridge : undefined;
    if (!bridge || !top || top.severity === 'LOW') return;
    const key = top.obligationId ?? top.spoken;
    if (notified.current.has(key)) return;
    notified.current.add(key);
    try { bridge.notify('CareCircle', top.spoken); } catch { /* bridge absent */ }
  }, [top?.obligationId, top?.spoken, top?.severity]);

  return (
    <div className="flex h-screen flex-col gap-7 bg-[radial-gradient(120%_100%_at_80%_0%,#0d1424_0%,#07090f_60%)] p-10 md:p-14 2xl:gap-6 2xl:px-16 2xl:py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4 2xl:gap-6">
          <span className="h-4 w-4 rounded-full bg-confirmed shadow-[0_0_22px_#7cf0c8] 2xl:h-6 2xl:w-6" />
          <div>
            <h1 className="text-3xl font-semibold md:text-4xl 2xl:text-6xl">Margaret's care circle</h1>
            <div className="text-base tracking-[0.04em] text-muted md:text-lg 2xl:text-2xl">THE SHARED CARE BOARD</div>
          </div>
        </div>
        <div className="flex items-center gap-3.5 text-lg text-muted md:text-xl 2xl:gap-5 2xl:text-3xl">
          <span className={`h-3 w-3 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat 2xl:h-4 2xl:w-4`} />
          {online ? <span><b className="text-ink">{gaps.length}</b> open · <b className="text-ink">{owned.length}</b> owned</span> : 'care board offline'}
        </div>
      </header>

      <div className="grid flex-1 content-start items-start auto-rows-min gap-5 overflow-hidden md:grid-cols-2 xl:grid-cols-3 2xl:gap-5">
        {empty && (
          <div className="col-span-full flex h-full flex-col items-center justify-center gap-3 text-muted">
            <div className="text-3xl text-ink">Nothing outstanding.</div>
            <div>Everything recorded has an owner.</div>
          </div>
        )}

        {shown.map((item, i) => {
          if (item.t === 'proposal') {
            return (
              <Card key={`p-${item.o.id}`} border="border-l-inferred" pill="proposed">
                <div className="text-2xl font-semibold leading-snug 2xl:text-3xl">{item.o.what}</div>
                <div className="mt-3 text-lg leading-snug text-[#c3cad9] 2xl:mt-3 2xl:text-xl">Inferred by the system - not treated as real work until a person confirms it.</div>
                <div className="mt-4"><ProvChip kind="INFERRED" /></div>
              </Card>
            );
          }
          if (item.t === 'owned') {
            return (
              <Card key={`o-${item.o.id}`} border="border-l-confirmed" pill="claimed">
                <div className="text-2xl font-semibold leading-snug 2xl:text-3xl">{item.o.what}</div>
                <div className="mt-3 text-lg text-[#c3cad9] 2xl:mt-4 2xl:text-xl"><b className="text-confirmed">{item.o.owner ?? 'someone'}</b> has this.</div>
                <div className="mt-4"><ProvChip kind={item.o.provenance} /></div>
              </Card>
            );
          }
          const g = item.g;
          const key: Provenance = provFromGap(g.kind, g.obligationId ? obById[g.obligationId]?.provenance : undefined);
          return (
            <Card key={`g-${i}`} border={SEV_BORDER[g.severity] ?? 'border-l-muted'} pill={g.kind}>
              <div className="text-2xl font-semibold leading-snug 2xl:text-3xl">{g.spoken}</div>
              <div className="mt-3 text-lg leading-snug text-[#c3cad9] 2xl:mt-3 2xl:text-xl">{g.because}</div>
              <div className="mt-4"><ProvChip kind={key} /></div>
            </Card>
          );
        })}
      </div>

      <footer className="flex flex-wrap gap-7 border-t border-line pt-5 text-base text-muted md:text-lg 2xl:gap-12 2xl:pt-8 2xl:text-2xl">
        <Legend color="bg-confirmed" text="Confirmed - a person stated it" />
        <Legend color="bg-inferred" text="Inferred - the system guessed, awaiting confirmation" />
        <Legend color="bg-norecord" text="No record - not the same as it not happening" />
        {hidden > 0 && <span className="ml-auto text-muted">+{hidden} more on your phone</span>}
      </footer>
    </div>
  );
}

function Card({ children, border, pill }: { children: React.ReactNode; border: string; pill: string }) {
  return (
    <div className={`glass animate-rise rounded-2xl border-l-[6px] p-6 md:p-7 2xl:rounded-3xl 2xl:p-6 ${border}`}>
      <div className="float-right rounded-full border border-line px-3 py-1.5 text-[13px] uppercase tracking-wider text-muted 2xl:px-4 2xl:py-2 2xl:text-lg">{pill}</div>
      {children}
    </div>
  );
}
function Legend({ color, text }: { color: string; text: string }) {
  return <span className="flex items-center gap-2.5"><span className={`h-3 w-3 rounded-full ${color}`} />{text}</span>;
}
