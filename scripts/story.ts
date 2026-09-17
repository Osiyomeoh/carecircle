/**
 * The crazy user story, executed end to end.
 *
 * One command. It seeds the exact opening state, starts the real CareCircle MCP
 * server in-process (Streamable HTTP, spec 2025-11-25), and walks all seven beats
 * through real MCP clients - one per member of the care circle, each on their own
 * credential. Nothing is faked or narrated by hand: every line the assistant says
 * is a real tool response, and every state change is the server's own.
 *
 *   npm run story
 *
 * This is the sequence the demo video screen-captures. Because it is deterministic
 * and self-contained, anyone who clones the repo sees precisely what the video shows.
 *
 * What is BUILT and exercised here: Alexa+ voice logging, appointment inference,
 * constraint discovery, the Care Gap engine, ownership, the Ring signal adapter,
 * the Known != Assumed trust model, and the shared record read from four roles.
 * What is deliberately NOT here: Bee (architecturally ready via the same signal
 * adapter, not integrated) and the Fire TV surface (the existing web board). The
 * conversation-derived note stands in for the Bee seam, honestly labelled.
 */
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../src/demo/seed.ts';
import { seedScenario } from '../src/demo/scenario.ts';
import { createCareCircleApp } from '../src/http/app.ts';

const HOUSEHOLD = 'h_margaret';
const TZ = 'America/New_York';

/**
 * The UTC instant for a wall-clock time today in a timezone. The story is set in
 * the evening, so the server clock runs then; individual events (the morning dose,
 * the evening dose) still carry their own true times via occurredAt.
 */
function wallClockToday(hour: number, minute: number, tz: string, base = new Date()): Date {
  // Anchor the day to the calendar date in `tz`, not UTC: in the evening in the
  // Americas the UTC date is already tomorrow, which would misplace "today".
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(base);
  const [y, mo, d] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(y!, mo! - 1, d!, hour, minute, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hour12: false, minute: '2-digit',
  }).formatToParts(guess);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const drift = (h * 60 + m) - (hour * 60 + minute);
  return new Date(guess.getTime() - drift * 60_000);
}

// --- pretty transcript ------------------------------------------------------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;

function beat(time: string, title: string): void {
  console.log(`\n${bold(cyan(`  ${time}`))}  ${bold(title)}`);
}
function say(who: string, text: string): void {
  console.log(`  ${who}: "${text}"`);
}
function alexa(r: any): any {
  console.log(`    ${amber('Alexa')}: ${r.content?.[0]?.text ?? '(no text)'}`);
  return r;
}
function board(gaps: any[]): void {
  console.log(dim('    ── Care Gaps ─────────────────────────────────'));
  if (gaps.length === 0) { console.log(dim('    (nothing unowned)')); return; }
  for (const g of gaps) {
    const mark = g.obligationId ? '•' : '?';
    console.log(dim(`    ${mark} [${String(g.severity).padEnd(6)}] ${g.spoken}`));
  }
}

const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<any>;
const gapsOf = (r: any): any[] => r.structuredContent?.gaps ?? [];

async function connect(baseUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: `carecircle-story-${token}`, version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  return client;
}

async function main(): Promise<void> {
  // The story plays out in the evening - 9:10pm, past the grace on the 8pm dose, so
  // the absence beat surfaces a genuinely-overdue record rather than a premature one.
  const clock = () => wallClockToday(21, 10, TZ);
  // The scenario seeds its dated events off its own `now`; hand it a midday instant
  // so its internal date math lands squarely on today, then run the clock in the
  // evening. Both agree on the calendar day; only the time-of-day differs.
  const seedNow = wallClockToday(12, 0, TZ);

  // 1. A clean, deterministic opening state in a throwaway store.
  const dbPath = join(mkdtempSync(join(tmpdir(), 'carecircle-story-')), 'story.db.json');
  const store = new CareStore(new FilePersistence(dbPath));
  await store.reset();
  await seedDemoHousehold(store);
  const { cardiologyAt, rideObligationId } = await seedScenario(store, HOUSEHOLD, {
    now: seedNow,
    // The ride is Renee's at the open, so the constraint beat can orphan it live.
    rideClaimedByRenee: true,
    // Beat one logs the heart pill on camera; don't seed a duplicate dose.
    skipMorningHeartPill: true,
  });

  // 2. The real server, in-process. Same factory the deployed server uses.
  const tokens = new Map(Object.entries(DEMO_TOKENS));
  const app = createCareCircleApp({ store, tokens, now: clock });
  const http = app.listen(0);
  await new Promise<void>((r) => http.once('listening', r));
  const { port } = http.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/mcp`;

  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', hour: 'numeric', minute: '2-digit',
  }).format(cardiologyAt);

  // 3. Four members, four credentials, four sessions.
  const margaret = await connect(url, 'margaret-token');
  const david = await connect(url, 'david-token');
  const renee = await connect(url, 'renee-token');
  const aide = await connect(url, 'aide-token');

  const tools = await david.listTools();
  console.log(bold('\nCareCircle - the one-day story, over real MCP'));
  console.log(dim(`  server: ${url}  ·  spec 2025-11-25  ·  ${tools.tools.length} tools`));
  console.log(dim(`  cardiology is genuinely ${when} in ${TZ}`));

  // ── Beat 1 · 7:42am - she logs her own care by talking ──────────────────
  beat('7:42am', 'The parent logs her own care by voice');
  say('Margaret (kitchen Echo)', 'Alexa, I took my heart pill.');
  alexa(await call(margaret, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill',
    occurredAt: wallClockToday(7, 42, TZ).toISOString(),
  }));

  // ── Beat 2 · the constraint - work comes loose, silently ────────────────
  beat('9:15am', 'A constraint quietly orphans work nobody re-assigned');
  say('Renee (phone)', "I can't drive Mom to cardiology on Thursday after all.");
  alexa(await call(renee, 'add_note', {
    note: "I can't drive Mom to cardiology Thursday.",
    unavailable: {
      memberName: 'Renee',
      from: new Date(cardiologyAt.getTime() - 3 * 3600_000).toISOString(),
      to: new Date(cardiologyAt.getTime() + 3 * 3600_000).toISOString(),
    },
  }));

  // ── Beat 3 · 2:14pm - a doorbell becomes evidence, never a conclusion ────
  beat('2:14pm', 'Ring sees a delivery - evidence toward the prescription, not proof');
  say('Ring doorbell', '(a package is left at Margaret\'s door)');
  alexa(await call(david, 'ingest_signal', {
    source: 'ring', kind: 'delivery_arrived',
    detail: 'Package left at front door',
  }));

  // ── Beat 4 · 6:30pm - the question no other assistant answers ────────────
  beat('6:30pm', "What's going to fall through the cracks this week?");
  say('David (driving)', "Alexa, what's going to fall through the cracks this week?");
  const gapsRes = alexa(await call(david, 'get_care_gaps', { withinDays: 7 }));
  board(gapsOf(gapsRes));

  const ride = gapsOf(gapsRes).find((g) => g.obligationId === rideObligationId)
    ?? gapsOf(gapsRes).find((g) => /cardiology|drive/i.test(g.spoken));
  say('David', "I'll drive Thursday.");
  alexa(await call(david, 'claim_obligation', { obligationId: ride.obligationId }));

  // The delivery pointed at the prescription; David confirms it and closes it out.
  const rx = gapsOf(gapsRes).find((g) => /prescription/i.test(g.spoken));
  say('David', 'And yes - that package was the prescription. Mark it picked up.');
  await call(david, 'claim_obligation', { obligationId: rx.obligationId });
  alexa(await call(david, 'resolve_obligation', {
    obligationId: rx.obligationId, note: 'Confirmed via the 2:14pm doorbell delivery.',
  }));

  // ── Beat 5 · 8:05pm - an absence, refused the shape of an accusation ─────
  beat('9:10pm', 'Known != Assumed - an absence is surfaced as a question');
  say('Ring doorbell', '(no activity at the door since afternoon)');
  alexa(await call(david, 'ingest_signal', {
    source: 'ring', kind: 'no_activity',
    detail: 'No activity detected at the door since 2:14pm',
  }));
  say('David', 'Did Mom take her evening pill?');
  const eveningRes = alexa(await call(david, 'get_care_gaps', {}));
  board(gapsOf(eveningRes));

  // ── Beat 6 · 8:06pm - the living room already knew; the gap clears ───────
  beat('9:12pm', 'The ambient board prompts a call; the gap clears everywhere');
  say('Renee (sees the Fire TV board)', 'I just called her - she took it at 7:50 and forgot to say.');
  alexa(await call(renee, 'log_care_event', {
    kind: 'medication_taken', medicationName: 'heart pill', aboutMemberId: 'm_margaret',
    occurredAt: wallClockToday(19, 50, TZ).toISOString(),
    detail: 'Confirmed by phone; Margaret took it at 7:50pm.',
  }));
  const closedRes = await call(david, 'get_care_gaps', {});
  console.log(dim('\n    After Renee confirms:'));
  board(gapsOf(closedRes));

  // ── Coda · one record, four roles ───────────────────────────────────────
  beat('-', 'One record, four people reach it differently');
  say('Tasha (paid aide)', 'What do I need to know for my shift?');
  alexa(await call(aide, 'get_shift_brief'));
  say('Renee (caregiver)', 'Assign the pharmacy run to David.');
  alexa(await call(renee, 'assign_obligation', { obligationId: ride.obligationId, assigneeName: 'David' }));

  console.log(bold(cyan('\n  CareCircle doesn\'t just tell a family what happened.')));
  console.log(bold(cyan('  It tells them what still needs someone.\n')));

  await Promise.all([margaret.close(), david.close(), renee.close(), aide.close()]);
  await new Promise<void>((r) => http.close(() => r()));
}

main().catch((err) => { console.error(err); process.exit(1); });
