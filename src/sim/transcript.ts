/**
 * Making a general-purpose transcript understand this particular household.
 *
 * Browser speech recognition is trained on everyone and knows nothing about the
 * people in one care circle, so the words it gets wrong are exactly the words
 * that matter: "Renee" comes back as "rainy", "Tasha" as "Tosha", "cardiology"
 * as "cardiologie". The rest of the sentence is usually fine.
 *
 * We already know the right answers. The care record holds every member name and
 * every medication being tracked, so the vocabulary that would fix the transcript
 * is sitting in the state the server just returned. This maps what was heard back
 * onto what exists.
 *
 * Two rules keep it from doing harm:
 *
 * 1. **It only ever corrects toward a name that really exists.** There is no
 *    general spell-check here; a word either resolves to somebody in this
 *    household or it is left exactly as it was heard.
 * 2. **Ordinary English is untouchable.** Phonetic matching collides more than
 *    people expect - "take" and "Tasha" share a Soundex code - so common words
 *    are refused outright rather than rescued by a threshold. Getting "I'll take
 *    it" turned into "I'll Tasha it" would be far worse than leaving a name
 *    misheard.
 *
 * Corrections are returned alongside the text rather than applied silently,
 * because a system that quietly rewrites what someone said should at least be
 * able to show its working.
 */

export interface Correction {
  /** The word as it was heard. */
  from: string;
  /** The name it was resolved to. */
  to: string;
}

export interface CorrectedTranscript {
  text: string;
  corrections: Correction[];
}

/** Minimal shape needed from the care state - anything with these fields works. */
export interface VocabularySource {
  members?: { name?: string; spokenAs?: string }[];
  medications?: { name?: string }[];
}

/**
 * Words that must survive the microphone unchanged.
 *
 * This is the safety rail, not an optimisation. Soundex is deliberately lossy,
 * so without this list a household containing "Tasha" would start eating the
 * word "take", which appears in half the sentences this product exists to hear.
 */
const UNTOUCHABLE = new Set([
  'the', 'and', 'for', 'was', 'not', 'but', 'you', 'all', 'can', 'her', 'his', 'our',
  'out', 'day', 'get', 'has', 'had', 'him', 'she', 'who', 'did', 'yes', 'now', 'new',
  'way', 'may', 'say', 'said', 'says', 'see', 'saw', 'seen', 'take', 'takes', 'taken',
  'took', 'taking', 'make', 'makes', 'made', 'give', 'gives', 'gave', 'given', 'need',
  'needs', 'needed', 'want', 'wants', 'know', 'knows', 'knew', 'think', 'go', 'goes',
  'going', 'went', 'gone', 'come', 'comes', 'came', 'tell', 'tells', 'told', 'ask',
  'asks', 'asked', 'call', 'calls', 'called', 'have', 'has', 'been', 'being', 'does',
  'done', 'will', 'would', 'could', 'should', 'there', 'their', 'they', 'them', 'this',
  'that', 'these', 'those', 'what', 'when', 'where', 'which', 'while', 'with', 'from',
  'into', 'over', 'about', 'after', 'again', 'still', 'just', 'like', 'time', 'today',
  'tonight', 'tomorrow', 'yesterday', 'morning', 'evening', 'night', 'week', 'month',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'mom', 'dad', 'mum', 'she', 'hers', 'mine', 'yours', 'ours', 'here', 'home',
  'ride', 'drive', 'pill', 'dose', 'note', 'card', 'thing', 'work', 'help',
]);

/** The Soundex of a word: a coarse phonetic key that survives most mishearings. */
export function soundex(word: string): string {
  const letters = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!letters) return '';
  const CODES: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };
  let out = letters[0]!;
  let previous = CODES[letters[0]!] ?? '';
  for (const ch of letters.slice(1)) {
    const code = CODES[ch] ?? '';
    if (code && code !== previous) out += code;
    // H and W are transparent: they do not break a run of the same code.
    if (ch !== 'H' && ch !== 'W') previous = code;
  }
  return (out + '000').slice(0, 4);
}

/** Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 1 when identical, 0 when nothing in common. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

/**
 * Every name this household actually uses.
 *
 * Multi-word terms ("heart pill") come back as-is and are matched as phrases;
 * single words are matched on their own.
 */
export function buildVocabulary(source: VocabularySource): string[] {
  const terms = new Set<string>();
  for (const member of source.members ?? []) {
    if (member.name) terms.add(member.name.trim());
    if (member.spokenAs) terms.add(member.spokenAs.trim());
  }
  for (const medication of source.medications ?? []) {
    if (medication.name) terms.add(medication.name.trim());
  }
  return [...terms].filter((t) => t.length > 0);
}

/** Does this heard word resolve to that known term? */
function resolves(heard: string, term: string): boolean {
  const a = heard.toLowerCase();
  const b = term.toLowerCase();
  if (a === b) return false;                    // already right
  if (a.length < 3 || b.length < 3) return false;
  if (UNTOUCHABLE.has(a)) return false;         // ordinary English wins, always
  // Sounds the same AND is about as long - the common case for a misheard name.
  // Soundex alone is far too eager: "run" and "Renee" share a code, and so do
  // "take" and "Tasha". Requiring similar length rules out the short everyday
  // words that collide with longer names, which the untouchable list above
  // cannot keep up with on its own.
  if (soundex(a) === soundex(b) && Math.abs(a.length - b.length) <= 1) return true;
  // Or is spelled nearly the same, for endings the recogniser invents.
  return similarity(a, b) >= 0.78;
}

/** Keep the shape of what was said: "renee," stays punctuated, "Renee" stays capitalised. */
function reshape(heard: string, corrected: string): string {
  const lead = heard.match(/^[^\p{L}]*/u)?.[0] ?? '';
  const tail = heard.match(/[^\p{L}]*$/u)?.[0] ?? '';
  const core = heard.slice(lead.length, heard.length - tail.length);
  const capitalised = core.length > 0 && core[0] === core[0]!.toUpperCase();
  const body = capitalised && corrected.length > 0
    ? corrected[0]!.toUpperCase() + corrected.slice(1)
    : corrected;
  return lead + body + tail;
}

/** Strip punctuation for comparison, keeping letters and digits. */
const bare = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Map a transcript onto the names this household actually uses.
 *
 * Phrases are tried before single words, so "heart pillow" resolves to "heart
 * pill" as a unit rather than having each half corrected separately.
 */
export function correctTranscript(text: string, vocabulary: string[]): CorrectedTranscript {
  if (!text.trim() || vocabulary.length === 0) return { text, corrections: [] };

  const phrases = vocabulary.filter((t) => t.includes(' '));
  const words = vocabulary.filter((t) => !t.includes(' '));
  const corrections: Correction[] = [];
  const tokens = text.split(/(\s+)/); // keep the whitespace so spacing survives

  // --- phrases first, over adjacent word pairs -----------------------------
  for (const phrase of phrases) {
    const [first, second] = phrase.split(/\s+/);
    if (!first || !second) continue;
    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i]!.trim()) continue;
      const next = tokens[i + 2];
      if (next === undefined || !next.trim()) continue;
      const a = bare(tokens[i]!);
      const b = bare(next);
      const aOk = a.toLowerCase() === first.toLowerCase() || resolves(a, first);
      const bOk = b.toLowerCase() === second.toLowerCase() || resolves(b, second);
      // Something has to actually be wrong, or there is nothing to correct.
      if (aOk && bOk && `${a} ${b}`.toLowerCase() !== phrase.toLowerCase()) {
        corrections.push({ from: `${a} ${b}`, to: phrase });
        tokens[i] = reshape(tokens[i]!, first);
        tokens[i + 2] = reshape(next, second);
      }
    }
  }

  // --- then single words ---------------------------------------------------
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.trim()) continue;
    const heard = bare(token);
    if (!heard) continue;
    if (words.some((w) => w.toLowerCase() === heard.toLowerCase())) continue;
    const match = words.find((w) => resolves(heard, w));
    if (match) {
      corrections.push({ from: heard, to: match });
      tokens[i] = reshape(token, match);
    }
  }

  return { text: tokens.join(''), corrections };
}
