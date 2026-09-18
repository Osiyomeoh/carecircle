import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../lib/useBoard';
import { api, MEMBERS } from '../lib/api';
import { START, keyOf, reduce, type Nav } from '../lib/dpad';

/**
 * The Fire TV surface, designed to look like TV content - not a dashboard.
 *
 * A calm ambient home screen (clock, date, the household) with care gaps arriving
 * as notification cards that slide in over it, the way a TV OS surfaces an alert.
 * On a real Fire TV the same gap also fires a native heads-up notification via the
 * WebView bridge (AndroidBridge.notify); here it is shown on-screen so the surface
 * reads as ambient TV with a notification, whether or not the native bridge exists.
 *
 * It is also **operable by the remote**. That is the third channel: CareCircle's
 * thesis is that no single modality is load-bearing, and until now the television
 * proved only half of it. Voice serves someone who cannot see; the screen serves
 * someone who cannot hear; neither serves someone who cannot easily speak - after a
 * stroke, or with advanced Parkinson's, or simply across a room from the Echo. A
 * D-pad closes that, and the navigation logic lives in ../lib/dpad.ts so it can be
 * tested without a browser.
 */

interface AndroidBridge { notify(title: string, body: string): void; }
declare global { interface Window { AndroidBridge?: AndroidBridge } }

const ACCENT: Record<string, string> = {
  HIGH: '#ff6b6b', MEDIUM: '#ffc234', LOW: '#7cf0c8',
};

/** Seeded demo household, shown only when the live board can't be reached (dead
 *  network, or no backend). Mirrors src/demo/scenario.ts and always carries a HIGH
 *  gap; the online dot stays red, so it never masquerades as live. */
const DEMO_GAPS = [
  { spoken: "There's no record of Mom's evening heart pill from 20:00.", severity: 'HIGH', obligationId: 'demo_heart_pm' },
  { spoken: "Pick up Mom's prescription - nobody has taken this yet.", severity: 'MEDIUM', obligationId: 'demo_rx' },
  { spoken: 'Drive Mom to cardiology Thursday at 10 AM', severity: 'LOW', obligationId: 'demo_ride' },
];

/**
 * The order the household is offered in on the television.
 *
 * Margaret is on this list because she is a participant in her own care, not a
 * subject of it - she can take something on. But she is never the *default*: the
 * chooser opens on whoever is highlighted, and a viewer who presses OK twice
 * quickly would otherwise assign work in the care recipient's name without ever
 * having chosen her. A default that quietly decides who is responsible is the same
 * mistake as reading a missing record as a missed dose, and this is the one product
 * that cannot afford to make it.
 */
const CHOOSERS = [...MEMBERS].sort((a, b) =>
  Number(a.id === 'm_margaret') - Number(b.id === 'm_margaret'));

/** A gap turned into a spoken alert line. */
function alertText(spoken: string): string {
  return spoken.replace(/\s-\s.*$/, '').trim() || spoken;
}

export default function AmbientTV() {
  const { state, online } = useBoard();
  // The ambient card cycles every open gap (a LOW one still needs an owner); the
  // interruptive native heads-up below is gated to above-routine gaps only. When
  // the board was never reachable, fall back to the seeded demo set so the surface
  // stays alive offline.
  const gaps = state?.gaps ?? (online ? [] : DEMO_GAPS);

  // Live clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ---- the remote -------------------------------------------------------------
  const [nav, setNav] = useState<Nav>(START);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const navRef = useRef(nav);
  navRef.current = nav;
  const gapsRef = useRef(gaps);
  gapsRef.current = gaps;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = keyOf(e.key);
      if (!key) return;
      // An unhandled arrow scrolls the page and an unhandled Backspace navigates the
      // WebView out of the app, so a key we recognise is a key we consume.
      e.preventDefault();

      const step = reduce(navRef.current, key, {
        gaps: gapsRef.current.length,
        members: CHOOSERS.length,
      });
      setNav(step.nav);
      if (!step.claim) return;

      const gap = gapsRef.current[step.nav.gap];
      const member = CHOOSERS[navRef.current.member];
      if (!member) return;
      if (!gap?.obligationId) {
        // A gap with no obligation behind it is real (a medication with no record
        // is a gap, not a task) but there is nothing to claim. Say so, rather than
        // swallowing the press and looking broken.
        setClaimed('There is nothing to take on for that one.');
        return;
      }
      // Nothing about this is special-cased for the television: it is the same
      // claim_obligation the voice path calls, under the same identity rules.
      setClaiming(`${member.label} is taking it on…`);
      api.act(member.id, 'claim_obligation', { obligationId: gap.obligationId })
        .then(() => { setClaimed(`${member.label} has it.`); })
        .catch((err) => { setClaimed(`Couldn't claim that: ${String(err.message ?? err)}`); })
        .finally(() => setClaiming(null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Put the remote down and the set goes back to being a set.
  useEffect(() => {
    if (nav.mode === 'ambient') return;
    const id = setTimeout(() => setNav((n) => ({ ...n, mode: 'ambient' })), 25000);
    return () => clearTimeout(id);
  }, [nav]);

  // Clear the outcome line after it has been read at ten feet.
  useEffect(() => {
    if (!claimed) return;
    const id = setTimeout(() => setClaimed(null), 6000);
    return () => clearTimeout(id);
  }, [claimed]);

  const steering = nav.mode !== 'ambient';

  // Cycle the notification through the current gaps. `cycle` is monotonic (not an
  // index) so the loop keeps re-showing even with a single gap - idx % 1 stays 0
  // and would otherwise freeze the effect after the first hide.
  const [cycle, setCycle] = useState(0);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!gaps.length) { setShow(false); return; }
    // While someone is holding the remote the card must stay put; a surface that
    // slides away mid-press is unusable with a D-pad.
    if (steering) { setShow(true); return; }
    setShow(true);
    const dwell = setTimeout(() => setShow(false), 6500);      // visible
    const advance = setTimeout(() => {                          // then next cycle
      setCycle((c) => c + 1);
    }, 8000);
    return () => { clearTimeout(dwell); clearTimeout(advance); };
  }, [cycle, gaps.length, steering]);

  // Ambient picks the next card on a timer; the remote picks it deliberately.
  const index = steering ? Math.min(nav.gap, gaps.length - 1) : cycle % gaps.length;
  const current = gaps.length ? gaps[index] : undefined;

  // Fire the real Fire TV heads-up once per distinct gap (no-op in a browser).
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.AndroidBridge : undefined;
    if (!bridge || !current || current.severity === 'LOW') return;
    const key = current.obligationId ?? current.spoken;
    if (notified.current.has(key)) return;
    notified.current.add(key);
    try { bridge.notify('CareCircle', current.spoken); } catch { /* no bridge */ }
  }, [current?.obligationId, current?.spoken]);

  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="relative h-screen overflow-hidden bg-[#05070d] text-white">
      {/* Ambient cinematic backdrop - warm dusk glows drifting behind the clock. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[70vh] w-[70vh] rounded-full bg-[radial-gradient(circle,#2a3a6a_0%,transparent_65%)] blur-3xl animate-drift-slow" />
        <div className="absolute -bottom-52 right-[-10rem] h-[80vh] w-[80vh] rounded-full bg-[radial-gradient(circle,#6a3a52_0%,transparent_65%)] blur-3xl animate-drift-slower" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,transparent_0%,#04060c_85%)]" />
      </div>

      {/* Ambient home content - the clock is the "channel". */}
      <div className="relative flex h-full flex-col items-center justify-center">
        <div className="text-[15vw] font-semibold leading-none tracking-tight tabular-nums drop-shadow-[0_6px_40px_rgba(0,0,0,0.6)]">
          {time}
        </div>
        <div className="mt-2 text-[3vw] font-light text-white/70">{day}</div>
        <div className="mt-10 flex items-center gap-3 text-[1.4vw] uppercase tracking-[0.35em] text-white/40">
          <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'}`} />
          Margaret's care circle
        </div>

        {/* The remote is invisible unless you say it is there. */}
        {!steering && !claimed && gaps.length > 0 && (
          <div className="mt-6 text-[1.1vw] text-white/35">
            Press any direction on the remote to take something on
          </div>
        )}
        {claimed && (
          <div className="mt-6 rounded-full border border-white/20 bg-white/10 px-6 py-3 text-[1.4vw] text-white/90">
            {claimed}
          </div>
        )}
      </div>

      {/* The notification - slides in from the top like a TV OS alert. */}
      <div
        className={`absolute left-1/2 top-[6vh] w-[52vw] max-w-[900px] -translate-x-1/2 transition-all duration-700 ease-out
          ${show && current ? 'translate-y-0 opacity-100' : '-translate-y-24 opacity-0'}`}
      >
        {current && (
          <div
            className={`flex items-center gap-5 rounded-[1.6rem] bg-white/10 p-5 backdrop-blur-2xl transition-all duration-200
              ${steering
                ? 'border-4 border-white shadow-[0_0_0_10px_rgba(255,255,255,0.12),0_30px_80px_rgba(0,0,0,0.55)] scale-[1.03]'
                : 'border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,0.55)]'}`}
          >
            <div
              className="flex h-[4.5vw] max-h-20 min-h-14 w-[4.5vw] min-w-14 max-w-20 items-center justify-center rounded-2xl text-[2.4vw]"
              style={{ background: `${ACCENT[current.severity]}22`, color: ACCENT[current.severity] }}
            >
              ♥
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 text-[1.1vw] uppercase tracking-[0.2em] text-white/50">
                CareCircle
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT[current.severity] }} />
                <span style={{ color: ACCENT[current.severity] }}>needs an owner</span>
              </div>
              <div className="mt-1 text-[1.9vw] font-medium leading-snug">{alertText(current.spoken)}</div>
            </div>
            <div className="shrink-0 text-right">
              {/* Focus is never carried by colour or a glow alone: at ten feet, and
                  for a colour-blind viewer, the word SELECTED and the position are
                  what actually communicate. */}
              {steering && (
                <div className="mb-1 text-[0.95vw] font-semibold uppercase tracking-[0.2em] text-white">
                  ▶ Selected · {index + 1} of {gaps.length}
                </div>
              )}
              <div className="rounded-full border border-white/20 px-4 py-2 text-[1vw] uppercase tracking-wider text-white/60">
                {steering ? 'OK to take it on' : 'Say “I’ll take it”'}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Who is taking this on. A remote carries no identity, so the set asks
          rather than assuming whoever is nearest it. */}
      {nav.mode === 'identifying' && current && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#05070d]/85 backdrop-blur-xl">
          <div className="max-w-[70vw] text-center text-[2vw] font-light leading-snug text-white/80">
            {alertText(current.spoken)}
          </div>
          <div className="mt-8 text-[1.3vw] uppercase tracking-[0.3em] text-white/45">
            Who is taking this on?
          </div>
          <div className="mt-8 flex flex-wrap items-stretch justify-center gap-5">
            {CHOOSERS.map((m, i) => {
              const on = i === nav.member;
              return (
                <div
                  key={m.id}
                  className={`w-[16vw] rounded-2xl px-6 py-5 text-left transition-all duration-150
                    ${on ? 'border-4 border-white bg-white/15 scale-105' : 'border border-white/15 bg-white/5'}`}
                >
                  <div className="text-[1.8vw] font-medium text-white">{m.label}</div>
                  <div className="mt-1 text-[0.95vw] text-white/50">{m.sub}</div>
                  <div className={`mt-2 text-[0.9vw] font-semibold uppercase tracking-[0.2em] ${on ? 'text-white' : 'text-transparent'}`}>
                    ▶ Selected
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-10 text-[1.05vw] text-white/40">
            {claiming ?? 'Left and right to choose · OK to confirm · Back to cancel'}
          </div>
        </div>
      )}
    </div>
  );
}
