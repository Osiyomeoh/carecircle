import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './http/app.ts';
import { CareStore } from './store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from './demo/seed.ts';
import { seedScenario } from './demo/scenario.ts';
import { CARE_BOARD_HTML } from './mcp/app/care-board.ts';

/**
 * Modality independence.
 *
 * CareCircle is for a population in which sensory impairment is close to the norm
 * rather than an edge case: WHO counts over 1.5 billion people living with hearing
 * loss and at least 2.2 billion with vision impairment, concentrated in the age
 * group this system serves (see docs/EVIDENCE.md).
 *
 * So a voice-only care system excludes one group of that size, and a screen-only
 * care system excludes another. The architectural answer is a **dual guarantee**,
 * and these tests are what make it a guarantee rather than an intention:
 *
 *   A. The spoken answer is complete WITHOUT the screen.
 *      -> the board can never become load-bearing (blind and low-vision users).
 *   B. The structured answer is complete WITHOUT the speech.
 *      -> the voice can never become load-bearing (deaf and hard-of-hearing users).
 *
 * If either half fails, somebody loses access to their own family's care.
 */

let server: Server;
let base: string;
const store = new CareStore();

before(async () => {
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}/mcp`;
      resolve();
    });
  });
});

after(() => { server?.close(); });

const HEADERS = (token: string, sessionId?: string) => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${token}`,
  ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
});

async function session(token: string): Promise<string> {
  const res = await fetch(base, {
    method: 'POST', headers: HEADERS(token),
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'modality', version: '1.0' },
      },
    }),
  });
  const id = res.headers.get('mcp-session-id')!;
  await res.text();
  await fetch(base, {
    method: 'POST', headers: HEADERS(token, id),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return id;
}

async function call(token: string, id: string, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(base, {
    method: 'POST', headers: HEADERS(token, id),
    body: JSON.stringify({
      jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6),
      method: 'tools/call', params: { name, arguments: args },
    }),
  });
  const body = JSON.parse(await res.text());
  return {
    spoken: body?.result?.content?.[0]?.text ?? '',
    structured: body?.result?.structuredContent ?? {},
  };
}

/** Words that hand the listener off to something they may not be able to see. */
const VISUAL_DEIXIS = /\b(tap|click|below|above|on (the )?screen|see the|look at|shown here|as displayed|press the button)\b/i;

// --- A. the screen is never required -------------------------------------

test('A: the spoken care-gap answer never defers to something visual', async () => {
  const s = await session('renee-token');
  const { spoken } = await call('renee-token', s, 'get_care_gaps');
  assert.ok(spoken.length > 0, 'there should be something to say');
  assert.doesNotMatch(spoken, VISUAL_DEIXIS);
});

test('A: every individual gap is speakable on its own', async () => {
  const s = await session('renee-token');
  const { structured } = await call('renee-token', s, 'get_care_gaps');
  for (const gap of structured.gaps ?? []) {
    assert.ok(gap.spoken?.trim(), 'every gap needs a spoken form');
    assert.doesNotMatch(gap.spoken, VISUAL_DEIXIS);
    // Markdown and identifiers are not speech.
    assert.doesNotMatch(gap.spoken, /[*_#`|]|obl_|gap_/, `not speakable: ${gap.spoken}`);
  }
});

test('A: a refusal tells you what to do instead, without showing you anything', async () => {
  // Denials are part of the spoken surface too: an aide who cannot see a screen
  // still has to be told what she CAN do.
  const s = await session('aide-token');
  const { spoken } = await call('aide-token', s, 'get_care_gaps');
  assert.ok(spoken.trim().length > 0);
  assert.doesNotMatch(spoken, VISUAL_DEIXIS);
});

// --- B. the voice is never required --------------------------------------

/**
 * Everything the spoken answer tells you about a gap, present as data.
 *
 * This is the half that keeps a deaf or hard-of-hearing family member a full
 * participant: reading the board alone, they learn everything the speaker heard.
 */
const SPOKEN_FACTS = ['spoken', 'because', 'kind', 'severity', 'score', 'factors'] as const;

test('B: every fact the voice conveys is present in the structured answer', async () => {
  const s = await session('renee-token');
  const { spoken, structured } = await call('renee-token', s, 'get_care_gaps');
  const gaps = structured.gaps ?? [];
  assert.ok(gaps.length > 0, 'the scenario should produce gaps');

  for (const gap of gaps) {
    for (const field of SPOKEN_FACTS) {
      assert.ok(gap[field] !== undefined && gap[field] !== null,
        `a reader would lose "${field}" - the voice would be required`);
    }
    // The ranking must be auditable by eye, not only by ear.
    for (const term of ['cost', 'pDrop', 'confidence']) {
      assert.equal(typeof gap.factors[term], 'number', `factors.${term} must be readable`);
    }
    // What the speaker heard must itself be readable, word for word.
    assert.ok(spoken.includes(gap.spoken),
      'the spoken line must appear verbatim in the data a reader sees');
  }
});

test('B: work that can be acted on carries the id needed to act on it', async () => {
  // A reader must be able to DO what a speaker can do, not merely be informed.
  const s = await session('renee-token');
  const { structured } = await call('renee-token', s, 'get_care_gaps');
  for (const gap of structured.gaps ?? []) {
    assert.ok('obligationId' in gap,
      'without an id, a reader can see the work but cannot claim it');
  }
});

test('B: the board can render every fact the voice carries', () => {
  // A field present in the payload but absent from the view is still a fact only
  // the listener receives.
  for (const field of SPOKEN_FACTS) {
    assert.ok(CARE_BOARD_HTML.includes(field),
      `the board never reads "${field}", so that fact reaches ears only`);
  }
});

test('B: the state of a gap is conveyed in words, not by colour alone', () => {
  // Colour is invisible to a screen reader and ambiguous to a colour-blind reader.
  // "No record" is the single most important state on the card - it is the one a
  // family must not mistake for "she missed it".
  assert.match(CARE_BOARD_HTML, /no record/i,
    'the "no record" state must be written, not merely coloured');
  assert.match(CARE_BOARD_HTML, /needs an owner/i,
    'an unowned gap must say so in words');
});

test('B: the reader gets the reasoning, not just the headline', () => {
  // `because` carries why we believe this - "confirmed as needed, originally
  // inferred from cardiology appointment". The SPOKEN channel does not carry it
  // at all: speakGaps says only each gap's `spoken` line. So the reader is
  // strictly better served here, which is the direction the invariant allows.
  assert.match(CARE_BOARD_HTML, /gap\.because/,
    'the board must render the reasoning a listener never hears');
  assert.match(CARE_BOARD_HTML, /gap\.spoken/,
    'the board must also render exactly what a listener is told');
});

// --- the guarantee, stated once ------------------------------------------

test('neither channel is load-bearing: both halves hold together', async () => {
  const s = await session('renee-token');
  const { spoken, structured } = await call('renee-token', s, 'get_care_gaps');
  const gaps = structured.gaps ?? [];

  // Someone who can only hear gets every gap.
  const heard = gaps.filter((g: { spoken: string }) => spoken.includes(g.spoken));
  assert.equal(heard.length, gaps.length, 'a listener must not be told about fewer gaps');

  // Someone who can only read gets every gap, with its reasoning.
  const readable = gaps.filter((g: Record<string, unknown>) =>
    SPOKEN_FACTS.every((f) => g[f] !== undefined && g[f] !== null));
  assert.equal(readable.length, gaps.length, 'a reader must not be told about fewer gaps');
});
