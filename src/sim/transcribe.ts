import { Buffer } from 'node:buffer';
import {
  TranscribeStreamingClient, StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import {
  TranscribeClient, CreateVocabularyCommand, GetVocabularyCommand, UpdateVocabularyCommand,
} from '@aws-sdk/client-transcribe';

/**
 * Speech to text that knows who lives here.
 *
 * The browser's own recogniser is trained on everyone and has no idea what this
 * household is called, so we send the audio to Amazon Transcribe instead and hand
 * it the names up front as a custom vocabulary. Correcting a transcript after the
 * fact (see ./transcript.ts) repairs what the recogniser got wrong; telling the
 * recogniser the names beforehand stops it going wrong at all. They are worth
 * having together - the vocabulary catches the common cases, and the corrector is
 * still there for whatever slips past.
 *
 * Audio arrives as raw 16-bit little-endian PCM at 16 kHz mono, which is what
 * Transcribe wants and what a browser can produce without a container. That keeps
 * the whole path free of transcoding.
 */

const REGION = process.env['AWS_REGION'] ?? 'us-east-1';

/** Named per household; there is one care circle in this demo. */
const VOCABULARY_NAME = process.env['CARECIRCLE_VOCABULARY'] ?? 'carecircle-household';

/** Transcribe wants 16 kHz mono for this media encoding. */
export const SAMPLE_RATE = 16_000;

/** Below this there is no speech worth sending - a stray tap on the mic button. */
const MIN_SAMPLES = SAMPLE_RATE / 4; // 250ms

let streaming: TranscribeStreamingClient | undefined;
let control: TranscribeClient | undefined;
const streamingClient = () => (streaming ??= new TranscribeStreamingClient({ region: REGION }));
const controlClient = () => (control ??= new TranscribeClient({ region: REGION }));

/**
 * Cut the audio into frames Transcribe will accept.
 *
 * Exported because the framing is the part worth testing without calling AWS:
 * an odd-length buffer would split a sample down the middle and turn the tail of
 * every utterance into noise.
 */
export function frames(pcm: Buffer, bytesPerFrame = 3_200): Buffer[] {
  const even = pcm.length - (pcm.length % 2); // never split a 16-bit sample
  const out: Buffer[] = [];
  for (let offset = 0; offset < even; offset += bytesPerFrame) {
    out.push(pcm.subarray(offset, Math.min(offset + bytesPerFrame, even)));
  }
  return out;
}

/** Is there enough audio here to be worth a request? */
export function hasEnoughAudio(pcm: Buffer): boolean {
  return pcm.length / 2 >= MIN_SAMPLES;
}

/**
 * Transcribe's vocabularies accept single tokens, so a multi-word name is joined
 * with a hyphen - the documented form - and comes back hyphenated, which the
 * caller undoes.
 */
export function vocabularyPhrases(terms: string[]): string[] {
  return [...new Set(
    terms
      .map((t) => t.trim().replace(/\s+/g, '-'))
      .filter((t) => /^[\p{L}\p{N}'-]+$/u.test(t) && t.length > 1),
  )];
}

/** Undo the hyphenation Transcribe returns for multi-word vocabulary entries. */
export function unhyphenate(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms.filter((t) => t.includes(' '))) {
    const hyphenated = term.replace(/\s+/g, '-');
    out = out.replace(new RegExp(hyphenated, 'gi'), term);
  }
  return out;
}

/**
 * Make sure Transcribe knows this household's names.
 *
 * Creation is asynchronous on Amazon's side and takes a minute or so, so this
 * never blocks a turn: it kicks the work off, reports whether the vocabulary is
 * ready *now*, and the caller simply goes without it until it is. A vocabulary
 * that is still pending is not an error - it is a transcript that is slightly
 * worse for a minute.
 */
export async function ensureVocabulary(terms: string[]): Promise<string | undefined> {
  const phrases = vocabularyPhrases(terms);
  if (phrases.length === 0) return undefined;

  try {
    const existing = await controlClient().send(
      new GetVocabularyCommand({ VocabularyName: VOCABULARY_NAME }),
    );
    if (existing.VocabularyState === 'READY') return VOCABULARY_NAME;
    if (existing.VocabularyState === 'FAILED') {
      await controlClient().send(new UpdateVocabularyCommand({
        VocabularyName: VOCABULARY_NAME, LanguageCode: 'en-US', Phrases: phrases,
      }));
    }
    return undefined; // PENDING - use it next time
  } catch (err) {
    if ((err as { name?: string }).name !== 'BadRequestException') return undefined;
    // Not found yet: create it, and go without one for this turn.
    await controlClient().send(new CreateVocabularyCommand({
      VocabularyName: VOCABULARY_NAME, LanguageCode: 'en-US', Phrases: phrases,
    })).catch(() => undefined);
    return undefined;
  }
}

/**
 * Turn one utterance of PCM into text.
 *
 * Only finalised results are kept; partials exist to drive a live caption and
 * would otherwise duplicate the sentence.
 */
export async function transcribePcm(pcm: Buffer, vocabularyName?: string): Promise<string> {
  const chunks = frames(pcm);
  const audio = (async function* () {
    for (const chunk of chunks) yield { AudioEvent: { AudioChunk: chunk } };
  })();

  const response = await streamingClient().send(new StartStreamTranscriptionCommand({
    LanguageCode: 'en-US',
    MediaEncoding: 'pcm',
    MediaSampleRateHertz: SAMPLE_RATE,
    AudioStream: audio,
    ...(vocabularyName ? { VocabularyName: vocabularyName } : {}),
  }));

  let text = '';
  for await (const event of response.TranscriptResultStream ?? []) {
    for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
      if (result.IsPartial) continue;
      const alternative = result.Alternatives?.[0]?.Transcript;
      if (alternative) text += (text ? ' ' : '') + alternative;
    }
  }
  return text.trim();
}
