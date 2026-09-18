import { PollyClient, SynthesizeSpeechCommand, type Engine } from '@aws-sdk/client-polly';

/**
 * Speaking out loud, with Amazon Polly.
 *
 * The browser's own SpeechSynthesis was the first thing to go. It hands you a
 * different voice on every machine - Samantha on a Mac, Zira on Windows, and on
 * Linux something close to an answering machine - so what a listener hears is
 * decided by their operating system rather than by us. In a voice-first product
 * that is not a detail.
 *
 * Polly also gives the one control that matters most to the people this is built
 * for: pace. Older listeners, people with hearing loss, and anyone processing
 * language after a stroke need speech slower than a default rate, and being able
 * to slow it down without making it sound drunk needs a real engine.
 */

const REGION = process.env['AWS_REGION'] ?? 'us-east-1';

/**
 * Generative voices sound human; neural is the fallback where generative is not
 * offered. Ruth is warm and unhurried, which is the right register for a house
 * where somebody is being cared for.
 */
const VOICE = process.env['CARECIRCLE_POLLY_VOICE'] ?? 'Ruth';
const ENGINE = (process.env['CARECIRCLE_POLLY_ENGINE'] ?? 'generative') as Engine;

let client: PollyClient | null = null;
function polly(): PollyClient {
  client ??= new PollyClient({ region: REGION });
  return client;
}

/**
 * The three paces we offer, as **speed and breath together**.
 *
 * This started as rate alone and did not survive contact with Polly. The generative
 * engine quantizes `prosody rate` to coarse internal steps and reports nothing: at
 * 90% it returned audio byte-identical to 100%, and at 80% byte-identical to 75%.
 * Three rates, two distinct renderings, no error either time. There is no percentage
 * that produces a genuine middle speed.
 *
 * So `gentle` is not a slightly slower voice - it is the same voice with **longer
 * pauses between sentences**, which is closer to what the setting is for anyway.
 * These sentences carry a date, a name and a responsibility; for an older listener,
 * or someone processing language after a stroke, the room to finish parsing one
 * sentence before the next arrives does more good than shaving 10% off the speed.
 *
 * Breaks are structural, so the engine honours them at any length.
 *
 * Verify a change here by synthesizing one sentence at each pace and comparing the
 * BYTES. Asserting the SSML only proves we composed the request we intended to send,
 * which is precisely how a dead accessibility control passed its tests.
 */
export const PACES = {
  slow:   { rate: '75%',  breathMs: 900 },
  gentle: { rate: '100%', breathMs: 600 },
  normal: { rate: '100%', breathMs: 350 },
} as const;

/** Kept as a name because callers and docs speak of rates. */
export const RATES = {
  slow: PACES.slow.rate, gentle: PACES.gentle.rate, normal: PACES.normal.rate,
} as const;
export type Rate = keyof typeof PACES;

export function isRate(value: unknown): value is Rate {
  return typeof value === 'string' && value in PACES;
}

/** XML-escape, so a care note containing an ampersand cannot break the markup. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Wrap spoken text in SSML.
 *
 * A breath after each sentence is not decoration: these sentences carry a date, a
 * name and a responsibility, and run together they are genuinely hard to follow.
 */
export function toSsml(text: string, rate: Rate = 'normal'): string {
  const pace = PACES[rate];
  const body = escapeXml(text.trim())
    .replace(/([.!?])\s+/g, `$1<break time="${pace.breathMs}ms"/> `);
  return `<speak><prosody rate="${pace.rate}">${body}</prosody></speak>`;
}

export interface Spoken {
  audio: Buffer;
  contentType: string;
  voice: string;
  engine: string;
}

async function speakWith(text: string, rate: Rate, engine: Engine): Promise<Spoken> {
  const res = await polly().send(new SynthesizeSpeechCommand({
    Text: toSsml(text, rate),
    TextType: 'ssml',
    OutputFormat: 'mp3',
    VoiceId: VOICE as never,
    Engine: engine,
  }));
  if (!res.AudioStream) throw new Error('Polly returned no audio.');
  return {
    audio: Buffer.from(await res.AudioStream.transformToByteArray()),
    contentType: 'audio/mpeg', voice: VOICE, engine,
  };
}

/**
 * Synthesise speech, stepping down the engine rather than failing.
 *
 * Which engines a voice supports varies by voice and by region, and the failure
 * arrives at runtime. A slightly less lifelike voice is a far better outcome than
 * silence, so generative falls back to neural and neural to standard.
 */
const FALLBACKS: Record<string, Engine> = { generative: 'neural', neural: 'standard' };

export async function synthesize(text: string, rate: Rate = 'normal'): Promise<Spoken> {
  if (!text.trim()) throw new Error('Nothing to say.');
  let engine: Engine | undefined = ENGINE;
  let last: unknown;
  while (engine) {
    try {
      return await speakWith(text, rate, engine);
    } catch (err) {
      last = err;
      engine = FALLBACKS[engine];
    }
  }
  throw last instanceof Error ? last : new Error('Polly could not synthesise that.');
}
