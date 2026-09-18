import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, MEMBERS, type Member, type SpeechRate, type ToolCall } from '../lib/api';
import { record, type Recording } from '../lib/mic';
import { useBoard } from '../lib/useBoard';
import { ProvChip, provFromGap } from '../components/ProvChip';
import type { Provenance } from '../lib/api';

type Msg = { who: 'me' | 'alexa' | 'err'; text: string; tag?: string; heard?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRec: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

/** What the Web Speech API's error codes actually mean to someone demoing this. */
const VOICE_ERRORS: Record<string, string> = {
  'not-allowed': 'The browser blocked the microphone. Allow mic access for this site, then tap Speak again.',
  'service-not-allowed': 'The browser blocked its speech service. Allow mic access, or type instead.',
  'no-speech': "I didn't hear anything. Tap Speak and talk a little closer to the mic.",
  network: 'Speech recognition needs the network and could not reach it. Typing still works.',
  'audio-capture': 'No microphone was found. Plug one in, or type instead.',
  aborted: 'Voice input stopped.',
};

export default function Console() {
  const [member, setMember] = useState<Member>(MEMBERS[1]); // David
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  const [handsfree, setHandsfree] = useState(false);
  /** Why the mic is not listening, when it isn't. Null when nothing is wrong. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  /** Amazon Transcribe, which knows the household's names, vs the browser's own
   *  recogniser, which does not. Falls back automatically when anything fails. */
  const [accurate, setAccurate] = useState(true);
  const [level, setLevel] = useState(0);
  /** What the browser's recogniser thinks it is hearing, right now. Shown under
   *  the orb so the words appear as they are spoken instead of only at the end. */
  const [interim, setInterim] = useState('');
  const recordingRef = useRef<Recording | null>(null);
  /** Speech pace. Slower is an access control for older listeners, not a demo toggle. */
  const [rate, setRate] = useState<SpeechRate>('normal');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const { state, online } = useBoard(3000);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  /** What to do once a line has finished being spoken, whichever voice said it. */
  const afterSpeaking = useCallback(() => {
    setSpeaking(false);
    if (handsfree && recRef.current && !listening) {
      try { recRef.current.start(); } catch { /* */ }
    }
  }, [handsfree, listening]);

  /** The browser's own voice: the fallback, and whatever the OS happens to provide. */
  const speakLocally = useCallback((text: string) => {
    if (!window.speechSynthesis) { afterSpeaking(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate === 'slow' ? 0.75 : rate === 'gentle' ? 0.9 : 1.02;
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find((v) => /samantha|google us english|zira|aria/i.test(v.name))
      ?? voices.find((v) => v.lang?.startsWith('en'));
    if (pref) u.voice = pref;
    u.onstart = () => setSpeaking(true);
    u.onend = afterSpeaking;
    u.onerror = afterSpeaking;
    window.speechSynthesis.speak(u);
  }, [afterSpeaking, rate]);

  /**
   * Say a line.
   *
   * Polly first, because the browser's voice is whatever the listener's operating
   * system decided and varies from warm to robotic. If Polly is unreachable the
   * local voice still speaks - losing the nicer voice is a downgrade, not a
   * silence, which matters when speech is somebody's only channel.
   */
  const speak = useCallback((text: string) => {
    if (!speakOn) return;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    setSpeaking(true);
    void api.speak(text, rate).then((blob) => {
      if (!blob) { speakLocally(text); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); afterSpeaking(); };
      audio.onerror = () => { URL.revokeObjectURL(url); speakLocally(text); };
      void audio.play().catch(() => { URL.revokeObjectURL(url); speakLocally(text); });
    });
  }, [speakOn, rate, speakLocally, afterSpeaking]);

  const say = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setInput('');
    setMessages((m) => [...m, { who: 'me', text }]);
    setBusy(true);
    try {
      const turn = await api.say(member.id, text);
      // The server repairs names the recogniser mangles. Show the repair on the
      // message it changed rather than quietly replacing what somebody said.
      if (turn.corrections?.length) {
        const shown = turn.corrections.map((c) => `${c.from} → ${c.to}`).join(', ');
        setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, heard: shown } : msg)));
      }
      setMessages((m) => [...m, { who: 'alexa', text: turn.spoken, tag: 'Alexa' }]);
      setCalls((c) => [...turn.toolCalls, ...c].slice(0, 12));
      speak(turn.spoken);
    } catch (e) {
      setMessages((m) => [...m, { who: 'err', text: (e as Error).message }]);
    } finally { setBusy(false); }
  }, [member, speak]);

  // Held in a ref so the recogniser and the recorder can reach the current `say`
  // without being rebuilt every time it changes.
  const sayRef = useRef(say);
  useEffect(() => { sayRef.current = say; }, [say]);

  /**
   * Held in a ref so the recorder's endpoint callback can reach the current
   * `finishAccurately` without `listenAccurately` depending on it - the same
   * closure cycle that once silently killed the browser recogniser.
   */
  const finishRef = useRef<() => Promise<void>>(async () => {});

  /**
   * Listen using Amazon Transcribe.
   *
   * Records raw PCM, sends it once the speaker stops, and hands the text to the
   * same `say` the typed path uses. Any failure here drops back to the browser's
   * recogniser rather than losing the turn.
   */
  const listenAccurately = useCallback(async () => {
    setVoiceNote(null);
    try {
      // The recorder calls the end of the turn itself. Tapping Stop still works;
      // it is just no longer the only way to be heard, which matters when speech
      // is somebody's only channel and a second deliberate tap is not available.
      recordingRef.current = await record({
        onLevel: setLevel,
        onEnd: (reason) => {
          if (reason === 'nothing') {
            recordingRef.current?.cancel();
            recordingRef.current = null;
            setListening(false);
            setLevel(0);
            setVoiceNote("I didn't hear anything. Tap Speak and talk a little closer to the mic.");
            return;
          }
          void finishRef.current();
        },
      });
      setListening(true);
    } catch {
      setVoiceNote('The browser blocked the microphone. Allow mic access for this site, then tap Speak again.');
    }
  }, []);

  const finishAccurately = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    setListening(false);
    setLevel(0);
    if (!recording) return;
    setBusy(true);
    try {
      const { text } = await api.transcribe(await recording.stop());
      if (text.trim()) await sayRef.current(text);
      else setVoiceNote("I didn't catch that. Tap Speak and try again.");
    } catch (e) {
      setVoiceNote(`Transcription failed: ${(e as Error).message} Falling back to the browser's recogniser.`);
      setAccurate(false);
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { finishRef.current = finishAccurately; }, [finishAccurately]);

  const act = useCallback(async (tool: string, args: Record<string, unknown>) => {
    try {
      const res = await api.act(member.id, tool, args);
      setMessages((m) => [...m, { who: 'alexa', text: res.result, tag: 'Alexa · tapped' }]);
      setCalls((c) => [res, ...c].slice(0, 12));
      speak(res.result);
    } catch (e) {
      setMessages((m) => [...m, { who: 'err', text: (e as Error).message }]);
    }
  }, [member, speak]);

  /**
   * Speech recognition.
   *
   * The recogniser is built exactly once and reaches the latest `say` through a
   * ref. It used to depend on `say` directly, which was a silent killer: `speak`
   * closes over `listening`, `say` closes over `speak`, so the first `onstart`
   * set `listening` -> rebuilt `speak` -> rebuilt `say` -> re-ran this effect,
   * whose cleanup aborted the recognition that had just started. The mic
   * appeared dead with nothing in the console to explain why.
   */
  const handsfreeRef = useRef(handsfree);
  useEffect(() => { handsfreeRef.current = handsfree; }, [handsfree]);

  useEffect(() => {
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { setListening(true); setVoiceNote(null); setInterim(''); };
    rec.onend = () => { setListening(false); setInterim(''); };
    rec.onresult = (e: any) => {
      let t = ''; for (const r of e.results) t += r[0].transcript;
      setInput(t);
      setInterim(t);
      if (e.results[e.results.length - 1].isFinal && t.trim()) { setInterim(''); sayRef.current(t); }
    };
    // Every one of these used to fail silently. A demo where the mic quietly
    // does nothing is worse than one that says why it cannot hear you.
    rec.onerror = (e: any) => {
      setListening(false);
      setInterim('');
      handsfreeRef.current = false;
      setHandsfree(false);
      setVoiceNote(VOICE_ERRORS[e?.error] ?? `Voice stopped: ${e?.error ?? 'unknown error'}. Typing still works.`);
    };
    recRef.current = rec;
    return () => { try { rec.abort(); } catch { /* */ } };
  }, []);

  // One entry point for the microphone, so tapping the orb and tapping the
  // button cannot drift apart.
  const micDisabled = !accurate && !SpeechRec;
  const toggleMic = useCallback(() => {
    if (accurate) {
      void (listening ? finishAccurately() : listenAccurately());
      return;
    }
    const r = recRef.current; if (!r) return;
    setVoiceNote(null);
    if (listening) { r.stop(); return; }
    // start() throws if the recogniser is already running - surface it rather
    // than swallowing it, which is how this went unnoticed.
    try { r.start(); } catch { setVoiceNote('The microphone is already starting. Give it a second and try again.'); }
  }, [accurate, listening, listenAccurately, finishAccurately]);

  const gaps = state?.gaps ?? [];
  const obById = Object.fromEntries((state?.obligations ?? []).map((o) => [o.id, o]));
  const proposals = (state?.obligations ?? []).filter((o) => o.status === 'PROPOSED');
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED');
  const offers = state?.offers ?? [];

  return (
    <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 gap-6 p-5 md:p-8 lg:grid-cols-[1fr_1.1fr]">
      {/* LEFT: device + conversation */}
      <section className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 text-muted transition hover:text-ink">
            <span className="h-2.5 w-2.5 rounded-full bg-core shadow-[0_0_14px_#7cf0c8]" />
            <b className="text-ink">CareCircle</b><span className="text-sm">· console</span>
          </Link>
          <div className={`glass flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.75rem] ${online ? 'text-muted' : 'text-sevHigh'}`}>
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`} />
            {online ? 'connected' : 'offline'}
          </div>
        </div>

        {/* who is speaking */}
        <div className="flex flex-wrap gap-2">
          {MEMBERS.map((m) => (
            <button key={m.id} onClick={() => setMember(m)}
              className={`rounded-xl border px-3 py-2 text-left transition ${member.id === m.id ? 'border-core/50 bg-core/10' : 'border-line glass hover:border-line'}`}>
              <div className="text-sm font-semibold text-ink">{m.label}</div>
              <div className="text-[0.6875rem] text-muted">{m.sub}</div>
            </button>
          ))}
        </div>

        {/* device orb. Tapping it is the same action as the Speak button - the
            orb is the thing that looks tappable, so it had better be. */}
        <div className="glass flex flex-col items-center gap-3 rounded-2xl p-6">
          <button
            type="button"
            onClick={toggleMic}
            disabled={micDisabled}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            aria-pressed={listening}
            className="relative flex h-28 w-28 items-center justify-center rounded-full outline-none transition
              focus-visible:ring-2 focus-visible:ring-core focus-visible:ring-offset-2 focus-visible:ring-offset-bg
              disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-pointer">
            {/* Rings leave the orb only while it is listening, so the animation
                means one specific thing rather than being decoration. */}
            {listening && <>
              <span className="absolute inset-0 rounded-full bg-alexa/30 animate-ripple" aria-hidden />
              <span className="absolute inset-0 rounded-full bg-alexa/20 animate-ripple" style={{ animationDelay: '0.6s' }} aria-hidden />
            </>}
            <span className={`absolute inset-0 rounded-full transition ${listening ? 'bg-alexa/20' : speaking ? 'bg-core/20' : 'bg-white/5'}`} aria-hidden />
            <span className={`relative h-16 w-16 rounded-full bg-gradient-to-br shadow-glow transition
              ${speaking ? 'from-core to-alexa scale-110' : listening ? 'from-alexa to-[#2f6fd0] scale-105' : 'from-alexa to-[#2f6fd0] animate-breath'}`} aria-hidden />
          </button>

          <div className="min-h-[1.5rem] text-center" aria-live="polite">
            {listening ? (
              <div className="text-[1.0625rem] font-semibold tracking-wide text-alexa">Speak now</div>
            ) : speaking ? (
              <div className="text-[0.9375rem] font-medium text-core">Speaking…</div>
            ) : (
              <div className="text-[0.8125rem] text-muted">
                {micDisabled ? 'voice needs Chrome - typing works' : 'Tap the orb and speak'}
              </div>
            )}
            {listening && (
              <div className="mt-0.5 text-[0.6875rem] text-muted">
                {accurate ? 'pause when you finish - or tap to stop now' : 'pause when you finish'}
              </div>
            )}
          </div>

          {/* A live peak meter, so it is obvious the microphone is hearing you. */}
          {listening && accurate && (
            <div className="flex h-5 items-end gap-1" aria-hidden>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="w-1.5 rounded-full bg-alexa transition-all duration-75"
                  style={{ height: `${Math.max(4, Math.min(1, level * (1.4 - Math.abs(i - 3) * 0.12)) * 20)}px` }} />
              ))}
            </div>
          )}

          {/* The words as they are heard. Transcribe only answers once the
              speaker stops, so this is the browser recogniser's to fill. */}
          {listening && !accurate && (
            <div className="min-h-[1.25rem] max-w-sm text-center text-[0.875rem] italic leading-snug text-ink/80">
              {interim || <span className="text-muted not-italic">listening…</span>}
            </div>
          )}
          {voiceNote && (
            <div className="max-w-sm rounded-lg border border-norecord/40 bg-norecord/10 px-3 py-2 text-center text-[0.75rem] leading-relaxed text-norecord">
              {voiceNote}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button disabled={micDisabled} onClick={toggleMic}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${listening ? 'bg-alexa text-[#04120d]' : 'glass text-ink'} disabled:opacity-40`}>
              {listening ? 'Stop' : '🎙 Speak'}
            </button>
            <label className="glass flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[0.75rem] text-muted">
              <input type="checkbox" checked={speakOn} onChange={(e) => setSpeakOn(e.target.checked)} /> speak replies
            </label>
            <label className="glass flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[0.75rem] text-muted"
              title="How fast replies are spoken. Slower speech is easier to follow for older listeners and anyone with hearing loss.">
              pace
              <select value={rate} onChange={(e) => setRate(e.target.value as SpeechRate)}
                className="bg-transparent text-ink outline-none">
                <option className="bg-bg" value="slow">slow</option>
                <option className="bg-bg" value="gentle">gentle</option>
                <option className="bg-bg" value="normal">normal</option>
              </select>
            </label>
            <label className="glass flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[0.75rem] text-muted"
              title="Amazon Transcribe, given this household's names as a custom vocabulary. Off uses the browser's own recogniser.">
              <input type="checkbox" checked={accurate} onChange={(e) => setAccurate(e.target.checked)} /> Transcribe
            </label>
            <label className="glass flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[0.75rem] text-muted">
              <input type="checkbox" checked={handsfree} onChange={(e) => setHandsfree(e.target.checked)} /> hands-free
            </label>
          </div>
        </div>

        {/* transcript */}
        <div ref={scrollRef} className="glass flex-1 space-y-3 overflow-y-auto rounded-2xl p-4" style={{ minHeight: 220, maxHeight: 340 }}>
          {messages.length === 0 && <div className="p-6 text-center text-sm text-muted">Speak or type as {member.label}. Try “Did Mom take her heart pill?”</div>}
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-snug animate-rise ${
              m.who === 'me' ? 'ml-auto bg-alexa/15 text-ink' : m.who === 'err' ? 'bg-sevHigh/15 text-sevHigh' : 'bg-white/5 text-ink'}`}>
              {m.tag && <div className="mb-0.5 text-[0.6875rem] uppercase tracking-wider text-muted">{m.tag}</div>}
              {m.text}
              {m.heard && (
                <div className="mt-1.5 border-t border-line pt-1.5 text-[0.6875rem] text-muted">
                  heard as {m.heard}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="max-w-[85%] rounded-2xl bg-white/5 px-4 py-2.5 text-muted">…</div>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); say(input); }} className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Speak as ${member.label}…`}
            className="glass flex-1 rounded-xl px-4 py-3 text-ink outline-none placeholder:text-muted" />
          <button disabled={busy} className="rounded-xl bg-gradient-to-r from-core to-[#57c6ff] px-5 py-3 font-semibold text-[#04120d] disabled:opacity-50">Send</button>
        </form>
      </section>

      {/* RIGHT: live board */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Care board</h2>
          <Link to="/tv" className="text-sm text-muted transition hover:text-ink">TV view →</Link>
        </div>
        <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 120px)' }}>
          {proposals.map((p) => (
            <BoardCard key={p.id} accent="border-l-inferred" pill="proposed">
              <div className="text-lg font-semibold">{p.what}</div>
              <div className="mt-1.5 text-sm text-[#c3cad9]">Inferred - not real work until a person confirms it.</div>
              <div className="mt-3 flex items-center gap-2">
                <ProvChip kind="INFERRED" />
                <button onClick={() => act('confirm_proposal', { obligationId: p.id, confirmed: true })} className="btn-primary">Yes, needed</button>
                <button onClick={() => act('confirm_proposal', { obligationId: p.id, confirmed: false })} className="btn-ghost">Not needed</button>
              </div>
            </BoardCard>
          ))}

          {offers.map((o) => (
            <BoardCard key={o.offerId} accent="border-l-alexa" pill="ready to buy">
              <div className="text-lg font-semibold">{o.item}</div>
              <div className="mt-1.5 text-sm text-[#c3cad9]">{o.merchant} · {o.etaText} · <b className="text-ink">${(o.amountCents / 100).toFixed(2)}</b></div>
              <div className="mt-2 text-[0.75rem] text-muted">Sandbox - no real payment is taken.</div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => act('confirm_purchase', { offerId: o.offerId, confirmed: true })} className="btn-primary">Confirm · ${(o.amountCents / 100).toFixed(2)}</button>
                <button onClick={() => act('confirm_purchase', { offerId: o.offerId, confirmed: false })} className="btn-ghost">Not now</button>
              </div>
            </BoardCard>
          ))}

          {gaps.map((g, i) => {
            const key: Provenance = provFromGap(g.kind, g.obligationId ? obById[g.obligationId]?.provenance : undefined);
            const sev = g.severity === 'HIGH' ? 'border-l-sevHigh' : g.severity === 'MEDIUM' ? 'border-l-sevMed' : 'border-l-sevLow';
            return (
              <BoardCard key={i} accent={sev} pill={g.kind}>
                <div className="text-lg font-semibold">{g.spoken}</div>
                <div className="mt-1.5 text-sm text-[#c3cad9]">{g.because}</div>
                <div className="mt-3 flex items-center gap-2">
                  <ProvChip kind={key} />
                  {g.obligationId && <button onClick={() => act('claim_obligation', { obligationId: g.obligationId })} className="btn-primary">I'll take it</button>}
                </div>
              </BoardCard>
            );
          })}

          {owned.map((o) => (
            <BoardCard key={o.id} accent="border-l-confirmed" pill="claimed">
              <div className="text-lg font-semibold">{o.what}</div>
              <div className="mt-1.5 text-sm text-[#c3cad9]"><b className="text-confirmed">{o.owner ?? 'someone'}</b> has this.</div>
              <div className="mt-3"><ProvChip kind={o.provenance} /></div>
            </BoardCard>
          ))}

          {!proposals.length && !offers.length && !gaps.length && !owned.length && (
            <div className="glass rounded-2xl p-8 text-center text-muted">Nothing outstanding. Everything recorded has an owner.</div>
          )}

          {calls.length > 0 && (
            <div className="glass mt-2 rounded-2xl p-4">
              <div className="mb-2 text-[0.6875rem] uppercase tracking-wider text-muted">Tool calls (real MCP)</div>
              <div className="space-y-1.5">
                {calls.map((c, i) => (
                  <div key={i} className={`flex items-center gap-2 text-[0.75rem] ${c.isError ? 'text-sevHigh' : 'text-muted'}`}>
                    <span className="w-12 text-right tabular-nums">{c.ms}ms</span>
                    <span className="font-semibold text-ink">{c.name}</span>
                    <span className="truncate">{JSON.stringify(c.arguments)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function BoardCard({ children, accent, pill }: { children: React.ReactNode; accent: string; pill: string }) {
  return (
    <div className={`glass animate-rise rounded-2xl border-l-[5px] p-4 ${accent}`}>
      <div className="float-right rounded-full border border-line px-2.5 py-1 text-[0.6875rem] uppercase tracking-wider text-muted">{pill}</div>
      {children}
    </div>
  );
}
