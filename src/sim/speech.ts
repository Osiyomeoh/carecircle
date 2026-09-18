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

/** Speech rates we expose. `slow` exists for listeners, not for demos. */
export const RATES = { slow: '75%', gentle: '90%', normal: '100%' } as const;
export type Rate = keyof typeof RATES;

export function isRate(value: unknown): value is Rate {
  return typeof value === 'string' && value in RATES;
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
  const body = escapeXml(text.trim())
    .replace(/([.!?])\s+/g, '$1<break time="350ms"/> ');
  return `<speak><prosody rate="${RATES[rate]}">${body}</prosody></speak>`;
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
