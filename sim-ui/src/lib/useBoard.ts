import { useEffect, useRef, useState } from 'react';
import { api, type BoardState } from './api';

/** Poll the live care board; only updates when the state actually changes. */
export function useBoard(intervalMs = 4000) {
  const [state, setState] = useState<BoardState | null>(null);
  const [online, setOnline] = useState(true);
  const fingerprint = useRef('');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.state();
        if (!alive) return;
        const fp = JSON.stringify([s.gaps, s.obligations, s.offers, s.notifications]);
        setOnline(true);
        if (fp !== fingerprint.current) { fingerprint.current = fp; setState(s); }
      } catch {
        if (alive) setOnline(false);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);

  return { state, online };
}
