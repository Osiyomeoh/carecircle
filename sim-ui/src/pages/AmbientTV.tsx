import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../lib/useBoard';

/**
 * The Fire TV surface, designed to look like TV content - not a dashboard.
 *
 * A calm ambient home screen (clock, date, the household) with care gaps arriving
 * as notification cards that slide in over it, the way a TV OS surfaces an alert.
 * On a real Fire TV the same gap also fires a native heads-up notification via the
 * WebView bridge (AndroidBridge.notify); here it is shown on-screen so the surface
 * reads as ambient TV with a notification, whether or not the native bridge exists.
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

  // Cycle the notification through the current gaps. `cycle` is monotonic (not an
  // index) so the loop keeps re-showing even with a single gap - idx % 1 stays 0
  // and would otherwise freeze the effect after the first hide.
  const [cycle, setCycle] = useState(0);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!gaps.length) { setShow(false); return; }
    setShow(true);
    const dwell = setTimeout(() => setShow(false), 6500);      // visible
    const advance = setTimeout(() => {                          // then next cycle
      setCycle((c) => c + 1);
    }, 8000);
    return () => { clearTimeout(dwell); clearTimeout(advance); };
  }, [cycle, gaps.length]);

  const current = gaps.length ? gaps[cycle % gaps.length] : undefined;

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
      </div>

      {/* The notification - slides in from the top like a TV OS alert. */}
      <div
        className={`absolute left-1/2 top-[6vh] w-[52vw] max-w-[900px] -translate-x-1/2 transition-all duration-700 ease-out
          ${show && current ? 'translate-y-0 opacity-100' : '-translate-y-24 opacity-0'}`}
      >
        {current && (
          <div className="flex items-center gap-5 rounded-[1.6rem] border border-white/15 bg-white/10 p-5 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
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
            <div className="shrink-0 rounded-full border border-white/20 px-4 py-2 text-[1vw] uppercase tracking-wider text-white/60">
              Say “I’ll take it”
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
