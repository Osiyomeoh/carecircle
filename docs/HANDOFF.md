# CareCircle - session handoff

A self-contained brief to resume work in a new session. Last updated 2026-09-18
(**the delegation loop: ask -> decline -> ask next -> accept**; the planner now
knows what day it is; **Amazon Polly** speaks replies with a listener-chosen pace;
**voice accuracy: Amazon Transcribe with a self-refreshing custom vocabulary +
transcript repair**; the console orb now shows listening state and a live interim
transcript; the interface scales from a 360px phone to a 4K television;
**MCP Apps: the Care Board ships as an interactive view**; TV surface reworked to
an ambient RN screen with sliding notifications, hosted live at `/tv-native`;
**OAuth 2.1 + PKCE**, so Alexa+ can link this add-on to a real person, with a
redirect allowlist; **modality independence is now a tested dual invariant**;
**docs/EVIDENCE.md** carries the cited research and economic case).

## What CareCircle is (updated positioning)

CareCircle is an **Alexa+ MCP server** that turns ordinary spoken care signals into a
shared family responsibility system. The one-sentence thesis:

> **Different devices produce different evidence. CareCircle turns that evidence into
> shared obligations, finds the Care Gaps nobody owns, and lets a family resolve them
> by voice - without ever turning a guess into a fact.**

The technical spine is `EVENTS → OBLIGATIONS → OWNERSHIP`. A **Care Gap** is the failure
state of the third stage (work is known to be needed and nobody owns it).

Positioning we're leaning into (not "AI for elderly care", not "Alexa for caregivers"):
**the responsibility layer for family care**, with **MCP as the seam** that lets
entirely different surfaces participate in one responsibility system.

Two product principles, both enforced in the type system and tests - not just copy:
- **Known ≠ Assumed** - a missing record is surfaced as *"there's no record,"* never
  *"she missed it."* (`CONFIRMED` / `INFERRED` / `NOT_LOGGED` provenance.)
- **Evidence ≠ Obligation ≠ Ownership** - a Ring package becomes "a package arrived"
  (an `INFERRED` proposal a human confirms), never "the prescription came."

### The unique idea: four surfaces, four kinds of evidence, one responsibility layer

The devices are NOT four integrations bolted on. They are four *kinds of evidence*
feeding ONE responsibility layer; MCP is the seam. The value is the seam, not any single
integration - which is why only Alexa+ is entered and the rest stay adapter-ready.

| Surface   | Kind of evidence                    | Status                              |
|-----------|-------------------------------------|-------------------------------------|
| Alexa+    | DECLARED - someone says it          | LIVE (real MCP host + Bedrock)      |
| Ring      | PHYSICAL - a sensor observed it     | SEAM (`ingest_signal`, hand-fired)  |
| Bee       | AMBIENT - overheard, nobody typed it| SEAM (would add `'bee'` source)     |
| Fire TV   | not evidence: the SHARED DISPLAY    | SEAM (the board renders there)      |

The full beat-by-beat user story lives in the `carecircle-demo-story` memory. One-day
arc: Margaret declares a dose (Alexa+) → Bee overhears knee pain → an INFERRED check-in
proposal → Ring sees a delivery → "was that the refill?" → David asks about the evening
dose → NO RECORD, not an accusation → three signals converge on one unowned gap →
`get_care_gaps` → Renee claims it by voice → reorder + confirm_purchase → Fire TV shows
the assembled shared truth. The gap-convergence moment is the one only the responsibility
layer can produce; no single device could.

## Track strategy (locked, per the official rules)

- **Primary track: Alexa+ (MCP).** We qualify cleanly - self-hosted MCP server, spec
  2025-11-25, Streamable HTTP, called in code (21 tools), live URL. Top-prize track.
- **Mini challenges: AWS Builder + Open Source.** Both qualify (Bedrock/DynamoDB/App
  Runner/SNS documented; `@carecircle/care-events` MIT package). A project can **win
  only one mini prize**, but entering both is allowed.
- **Ring IS enterable (corrected 2026-09-18).** The official rules say: *"Build a new
  app or extend an existing one using Ring APIs, SDKs, simulators, or devices"*,
  *"A physical Ring device is not required"*, and *"Show your project working through
  a simulator or an actual Ring device."* Ring's named priority categories include
  **accessibility and caretaking** - i.e. this product. An earlier note here called
  Ring un-enterable; that was wrong and cost us time. We now run a real verified
  webhook (see below).
  NOTE: Ring's OWN staging environment tests against real hardware ("Verify API
  integration with real Ring devices"), so the simulator is ours. The rules permit it.
- **Bee is still NOT enterable.** It requires *"real data recorded and processed
  through a Bee device or an Apple Watch running Bee software"*. We have neither, so
  Bee stays an architecturally-ready seam and is never claimed as an integration.
- **Fire TV** is not entered either; the web board is the presentation surface, no
  Fire-TV-specific app.

### Gap severity = expected harm (src/domain/gaps.ts)

Severity is not hand-tuned points. Each gap's `score` is an estimate of expected
harm, `risk = Cost x P(dropped) x Confidence`, all terms in [0,1]:
- **Cost** - normalized harm magnitude: medical 1.0, logistical 0.5, social 0.2.
- **P(dropped)** - a continuous exponential *hazard* on the deadline
  (`exp(-hoursUntil / 48h)`, →1 once overdue), OR-combined with an aging hazard
  (`1 - exp(-age / 72h)`) for unowned work. No bucket staircase, so ranking is
  monotone and never jumps at an edge.
- **Confidence** - a Bayesian posterior: CONFIRMED 1.0, NOT_LOGGED 0.75,
  INFERRED 0.6, multiplied in so an assumption can never outrank a fact. This is
  the "Known != Assumed" trust model expressed as arithmetic.

HIGH/MEDIUM/LOW are risk tertiles of `score` (0-100), not magic cutoffs.
When a judge asks "why 85?", the answer is a derivation, not a vibe.

The model's laws are proven, not just exemplified: `src/domain/gaps.props.test.ts`
uses fast-check to assert boundedness, determinism, confidence dominance
(Known >= Assumed), imminence monotonicity, and cost ordering over thousands of
generated states. And each gap carries `factors {cost, pDrop, confidence}`, so
the care board renders "why this ranks here" (harm x drop-risk x confidence) on
every card - the severity explains itself on screen instead of being an opaque
verdict.

## What's built vs. adapter-ready

**Built + tested (live code):** Alexa+ MCP server (21 tools, session-bound identity),
Care Gap engine (deterministic; severity is a stated risk model, see below),
trust/provenance model, `ingest_signal` (the real
Ring/Bee seam - any external signal → INFERRED proposal), ownership/claiming,
purchase-in-place (`reorder_prescription` / `confirm_purchase`), SNS notifications
(record-only fallback), DynamoDB persistence, App Runner deploy, the multi-device web
board (simulator), **the Care Board as an MCP App (SEP-1865)**, the delegation
loop, the Ring webhook, OAuth 2.1 + PKCE, **209 tests** + adversarial suite + CI.

**Adapter-ready (seam only, no live third-party wiring):** Ring → `ingest_signal`
(Ring's payload schema is unpublished - see FRICTION-LOG.md); Bee → `ingest_signal`
(deliberately gated); Fire TV → the web board would render there.

## DONE (2026-09-18): the Care Board as an MCP App

The loudest entry in our own feature requests ("Rich cards: a structured visual
return channel for MCP results") is now answered in the one place we can answer
it - the protocol. `get_care_gaps` is an **MCP App** (SEP-1865, spec dialect
`2026-01-26`): the tool points at a `ui://` resource, the resource returns a
self-contained HTML view, and the host renders it in a sandboxed iframe that talks
back over the same JSON-RPC.

**Files**
- `src/mcp/app/protocol.ts` - the extension's wire format (MIME type, both
  metadata key spellings, capability sniffing). We implement it directly instead
  of depending on `@modelcontextprotocol/ext-apps`, because that package targets
  the newer `@modelcontextprotocol/server` split while we are on `sdk@1.30.0`.
  The constants were read out of the published package, not out of blog prose -
  the two disagree, and the package wins.
- `src/mcp/app/care-board.ts` - the view (one self-contained document, no CDN,
  no fonts, no network beyond the host bridge, so it needs no CSP allowlist).
- `src/mcp/app/care-board.test.ts` - 7 tests over the wire.

**Three things it does that a card normally does not**
1. **Shows provenance per row** - CONFIRMED / INFERRED / *no record*. The "no
   record" chip is drawn quietly and its tooltip says an absence of information
   is not evidence. The trust model, on screen.
2. **Explains its own ranking** - tap a score and it expands to
   `cost x p(dropped) x confidence`. `get_care_gaps` now returns `factors`
   (it was computing and discarding them). An unauditable ranking over someone's
   medical care is the thing we set out not to build.
3. **Claiming closes the loop** - the button calls `claim_obligation` back
   through the host (same auth path as speech), re-reads the board, then sends
   `ui/update-model-context` so the model knows what the hands just did and does
   not go on offering work that is already taken.

**Gotchas found the hard way**
- Two metadata spellings are live in the wild: `_meta.ui.resourceUri` (current)
  and `_meta["ui/resourceUri"]` (pre-standard). Emit **both** or the board
  silently never appears on half of hosts. `appToolMeta()` does this.
- MIME must be exactly `text/html;profile=mcp-app`. `text/html+skybridge` is
  OpenAI's Apps SDK, a *different* dialect.
- The view must set `color-scheme` from `hostContext.theme`. A light-themed host
  inside a dark-mode browser otherwise keeps the UA's dark canvas while the
  board paints the host's dark text onto it - unreadable. Caught in the harness.
- The host pushes the originating result as `ui/notifications/tool-result`;
  fetching on init as well double-fetches. The view waits 400ms, then falls back.

**Verifying it without Claude Desktop:** there is a throwaway host harness pattern
in the session scratchpad - serve the emitted `board.html` next to a page that
answers `ui/initialize`, pushes a `tool-result`, and proxies `tools/call`. Both
themes and the full claim loop were verified that way.

**Degradation guarantee:** a host that cannot render ignores the resource and the
spoken answer is untouched. There is a test asserting the spoken text never says
"tap", "click" or "below" - the view must never become load-bearing.

## DONE (2026-09-18): voice accuracy, and the mic that did nothing

Three separate pieces of work, in the order they were needed.

### 1. The mic was dead (and silent about it)

A deterministic React bug, worth remembering because nothing appeared in the
console: `speak` closes over `listening` -> `say` closes over `speak` -> the
recognition effect depended on `say`. So `onstart` set `listening`, which rebuilt
`speak`, which rebuilt `say`, which re-ran the effect, whose **cleanup aborted the
recognition that had just started.** Fixed by building the recogniser exactly once
(`[]` deps) and reaching the current `say` through `sayRef`.

Compounding it: there was **no `rec.onerror` handler at all**, so every Web Speech
failure mode failed silently. `VOICE_ERRORS` now maps each code to something a
person can act on, shown in an amber box under the orb.

### 2. Transcript repair (`src/sim/transcript.ts`)

Recognisers mangle the names this household actually uses. The vocabulary is
derived from the care record itself - member names, `spokenAs` aliases, medication
names - and matched with **Soundex + Levenshtein**.

**The trap, caught by its own test:** "run" and "Renee" share Soundex code R500,
so "I'll run to the pharmacy" became "I'll Renee to the pharmacy". Guards now:
- a length guard (`Math.abs(a.length - b.length) <= 1`) on the Soundex path,
- an `UNTOUCHABLE` stoplist of common short words, checked first,
- a 0.78 similarity floor on the fallback path.

Corrections are **shown, never silent**: `heard as run -> Renee` renders under the
message it changed.

### 3. Amazon Transcribe (`src/sim/transcribe.ts`) - default path

Browser records raw PCM16LE @ 16kHz mono (`sim-ui/src/lib/mic.ts`, `AudioContext`
+ ScriptProcessor through a muted gain node so it runs without echoing), POSTs to
`/api/transcribe` (`express.raw`), server streams it to Transcribe **with the
household's names as a custom vocabulary**. The repair layer still runs behind it.
Any failure falls back to the browser recogniser and says so - which is exactly how
a missing IAM permission surfaced as a readable message instead of a dead mic.
This is also a second documented AWS integration for **AWS Builder**.

`frames()` never splits a 16-bit sample. `signature()` is an order-independent
fingerprint of the phrase set.

**Two bugs found only by reading back what Amazon actually held:**
- `ensureVocabulary` never refreshed a vocabulary already in `READY`, so it was
  frozen at whatever the household looked like on first boot. It now compares
  `phrasesOf(downloadUri)` against the current signature and rebuilds on drift.
  Verified self-healing live: `READY -> PENDING -> READY`, ending with
  `Tasha, David, Margaret, Mom, Renee, heart-pill, thyroid-tablet`.
- Medications were missing entirely because **`carecircle-mcp` had never been
  redeployed** - the documented both-services gotcha below, biting again.

### 4. The orb says what it is doing

The orb is now the control (tapping it is `toggleMic`, the same entry point as the
Speak button, so the two cannot drift apart). Idle breathes; listening shows a bold
**"Speak now"**, two staggered expanding rings, and the live peak meter; speaking is
a distinct colour and scale. On the browser-recogniser path the **interim transcript
streams under the orb** - Transcribe only answers once the speaker stops, so that
line is honestly left to the recogniser that can fill it. `prefers-reduced-motion`
is honoured globally in `index.css`.

## DONE (2026-09-18): the interface scales from a phone to a television

Root font ramps with the viewport in `sim-ui/src/index.css` (18px@1800 -> 22px@2200
-> 27px@2800 -> 33px@3500). Because Tailwind's type and spacing scales are **rem**,
moving the root size scales the whole interface at once rather than needing a
breakpoint per element. `tv: 1920px` / `tv4k: 3200px` breakpoints exist for the
places that is not enough; TVBoard carries overscan padding
(`tv:px-[3.5vw] tv:py-[3vh]`).

**Two real bugs found by measuring rather than looking**, at 360 / 375 / 768 / 1920
/ 3840:
- the console control row did not wrap - the hands-free toggle ran outside its own
  card at 375px (`flex-wrap`);
- the hero used `h-screen`, which is a **cap, not a floor**: 767px of copy locked
  into a 640px viewport, silently clipping the surface chips. Now `min-h-[100svh]`.

Verified at 3840x2160: `rootFont 33px`, `h1 123.75px`, no horizontal overflow.

## DONE (2026-09-18): the delegation loop - 21 tools

CareCircle could find work nobody owned. It could not pursue it. The gap between
"Margaret needs a ride Thursday" and someone actually driving her was one the
system could describe and not close.

`request_owner` / `respond_to_request` / `get_my_requests` (`src/domain/delegation.ts`).

**The central decision: `REQUESTED` is its own status and carries no owner.**
Being asked is not having agreed, and collapsing those is the same class of error
as reading a missing medication record as a missed dose. A pending request still
reads as a Care Gap and is spoken as *"David was asked and hasn't answered yet."*

**Risk arithmetic:** a pending ask earns a *discount*, not an exemption. Relief is
`0.55 * exp(-hoursWaiting / 12)`, so an unanswered request climbs back to the full
risk of unowned work within a day - the arithmetic of "I asked David" quietly
becoming "nobody is doing this".

**Who to ask** is deterministic and explainable. Family is a **tier**, not a
tie-break: ranking purely on who is least busy handed the paid aide the cardiology
drive ahead of both of Margaret's children, because she starts every week empty.
Within a tier it is load first. Declines are remembered; a *stated* conflict at the
due time excludes, mere silence does not.

**Margaret can ask; she cannot assign.** New `request_owner` capability granted to
care_recipient. She is a participant, not a subject.

E2E over the real MCP wire in `src/delegation.e2e.test.ts`, including that only the
person asked can answer. Note those tests reseed per test - the loop MOVES
ownership, so a second test would otherwise find the work taken.

## DONE (2026-09-18): the planner did not know what day it was

The live board was showing a cardiology appointment dated **19 December 2024**. It
was not stale seed data - `createdAt` was that morning. Someone said "Mom has
cardiology Thursday at ten", and the planner, never told today's date, invented a
timestamp near its own training prior and sent it **with no timezone**.

That was the real reason "Thursday" sounded random. The engine phrased the date
correctly; the date was fiction.

Three guards, outermost first:
- `systemPrompt({now, timezone})` in `src/sim/host.ts` stamps the current date and
  the household's zone (read from the state resource, so dates resolve where the
  family lives). Says never to guess a date. The eval harness uses the same
  stamped prompt. `SYSTEM_PROMPT` is kept as a deprecated alias.
- `src/domain/time.ts` - `toInstant()` reads a wall-clock timestamp in the
  household's zone instead of silently treating it as UTC (which had been moving
  every appointment by the offset), and `implausible()` refuses a date more than
  2 days past or 400 days ahead with a question.
- Spoken dates now always carry the date: **"Thursday the 24th"**, never a bare
  weekday, which on a Friday could mean six days out or thirteen.

**Still outstanding:** two zombie `PROPOSED` rows dated 2024-12-19 remain in the
live table and render as cards. Removal is `confirm_proposal(confirmed:false)` on
each - the product's own path, leaving an audit trail. Not done: it changes what
every visitor sees, so it needs the user's go-ahead.

## DONE (2026-09-18): Amazon Polly

`src/sim/speech.ts`, `POST /api/speak`. The browser's SpeechSynthesis gave a
different voice on every machine, so what a judge heard depended on their OS.
Polly Ruth/generative is identical everywhere - **verified live, returns
`x-carecircle-voice: Ruth/generative`.**

The reason it matters beyond polish is **pace**: `slow` (75%) / `gentle` (80%) /
`normal`, exposed in the console. Older listeners, people with hearing loss and
anyone processing language after a stroke need slower speech, and slowing it
without it sounding drunk needs a real engine. SSML also puts a 350ms breath after
each sentence.

Care-note text is XML-escaped before it reaches the markup. The engine steps down
generative -> neural -> standard rather than failing, and an unreachable Polly
falls back to the browser voice: a downgrade, never a silence.

**Fourth AWS service** after Bedrock, DynamoDB and Transcribe. Needs
`polly:SynthesizeSpeech` on the instance role (in `deploy-mcp.sh`). Note the
`conductor` *user* lacks Polly, so it cannot be tested from the CLI - verify
against the deployed service.

## DONE (2026-09-18): Ring, on a real verified webhook

`POST /ring/webhook` (`src/http/ring-webhook.ts`), implementing Ring's published
Partner API contract - **verified against Amazon's own Ring docs**: HMAC-SHA256
over the raw body in `X-Signature`, idempotency on `meta.request_id`, HTTP 200
within five seconds, event types `motion_detected` / `button_press`.

**Mounted BEFORE `express.json` and reads raw bytes.** An HMAC is computed over
exactly what was sent; parse-then-restringify reorders keys and whitespace and the
signature stops matching. This is the single easiest way to get a webhook subtly
wrong.

Three refusals, all load-bearing because this is a **public, unauthenticated URL
that writes into a family's medical record**:
- an unsigned or wrongly-signed body is rejected *before parsing* (401);
- a redelivery is acknowledged but not acted on twice - `SeenEvents` is bounded,
  since an unbounded set on a public endpoint is a way to be run out of memory;
- an event we do not act on still returns 200, or Ring retries it forever.

`applySignal` (`src/domain/ingest.ts`) is now shared by the webhook and the
`ingest_signal` tool, so a doorbell and a person describing a doorbell travel
identical code. A Ring event becomes an **INFERRED proposal**; a test asserts no
sensor ever resolves an obligation.

**The simulator** (`src/demo/ring-simulate.ts`, `npm run ring:simulate -- --url
<webhook> --event package`) signs with the **real partner HMAC key from .env**, so
what is simulated is the device and what is exercised is the integration.

Verified locally end to end: signed package -> `200 accepted`, `delivery_arrived`,
naming an existing obligation as `resolvesCandidate` *without* resolving it;
redelivery -> `200 duplicate`; unsigned -> `401`; obligations resolved by sensor: 0.

**Env:** `RING_HMAC_KEY` (in gitignored `.env`), `RING_HOUSEHOLD_ID` (default
`h_margaret`). Without the key the endpoint returns 503 rather than accepting
unverifiable claims about someone's home.

**Open uncertainty worth a friction-log entry:** our adapter reads a package
delivery from `attributes.sub_type` matching /package|delivery/, but Amazon's docs
describe `sub_type` as a classification (`human`, and by implication animal /
vehicle). Whether `package` is a real Ring sub_type is **unconfirmed** - the full
payload nesting is not published. Do not claim delivery detection as verified
against real Ring traffic.

**Still to do for the Ring track:** register the webhook URL in the Ring Developer
Portal (Staging tab, HTTPS, must return 200), and show the simulator driving the
live endpoint in the demo video.

## DONE (2026-09-18): OAuth 2.1 + PKCE, and the deploy that lied

`src/http/oauth.ts`, mounted by `src/http/app.ts` only when
`CARECIRCLE_OAUTH_SECRET` is set. Alexa+ will not link an add-on to a person
without it, and neither will Ring.

- RFC 9728 protected-resource metadata + RFC 8414 AS metadata at
  `/.well-known/...`, so a client discovers us instead of being configured.
- PKCE **S256 only**; an authorization code is single-use and is **burned on a
  failed exchange**, not just a successful one - otherwise a wrong verifier is a
  free retry against a live code.
- HS256 only; `verifyToken` rejects any other `alg` (the `alg:"none"` family).
- `CODE_TTL_MS` 60s, access token 1h, refresh 30d.

**Two failures worth remembering.**

1. **The routes 404'd after a deploy that reported success.** `update-service`
   applied the new env (the Ring endpoint moved 503 -> 401, proving env landed)
   while the container kept the **previous image**. The `:latest` tag makes this
   indistinguishable from a good deploy. This is the both-services
   `start-deployment` rule above, in a new disguise.
2. **OAuth then authenticated nothing in production** - `/health` still said
   `identity: "static"`. `src/http.ts` built its own resolver and never went
   through the app factory's composition. The tests missed it because they let
   the factory choose, i.e. they tested a path production did not take.
   Composition now lives in `resolverFromEnv` and there is a test through that
   shared path.

**Redirect allowlist, deliberately off in production.** `redirectAllowed()`
matches **exactly** (a prefix match would accept
`https://client.example.attacker.test` for `https://client.example`) and is
checked **before the consent screen is drawn**, so no one is asked to approve a
handoff we would refuse to complete. `CARECIRCLE_OAUTH_REDIRECTS` is
**intentionally empty in production**: Ring's redirect URI is not published, and
a guess would reject Ring's own linking. While empty the server logs
`client_id` / `redirect_uri` on every authorize. **Next action: read that line
out of the App Runner logs after the first real Ring link attempt, put the URI
in `CARECIRCLE_OAUTH_REDIRECTS`, redeploy - enforcement then starts with no code
change.**

## DONE (2026-09-18): modality independence is a tested invariant

`src/modality.test.ts`. Both halves now exist, so the thesis is verifiable by
running the tests rather than by reading the pitch:
- the spoken answer never says "tap"/"click"/"below" - the screen can never
  become required, so a blind listener has full access;
- every fact a gap carries (`spoken`, `because`, `kind`, `severity`, `score`,
  `factors`) is present in the board's structured data - voice can never become
  required, so a deaf reader has full access.

The invariant is **reader >= listener**, not token equality. An earlier version
demanded the literal strings `CONFIRMED`/`INFERRED` in the spoken text and
failed for the wrong reason; the board already renders provenance while voice
carries only `spoken`.

## DONE (2026-09-18): docs/EVIDENCE.md

Every figure behind the impact claim, each marked PRIMARY / SECONDARY /
CONTESTED - we apply our own trust model to our own argument. Leads with WHO,
ILO and Sub-Saharan African sources; US cost figures are supporting, not
primary. The sharpest line: Cameroon has **fewer than 50 nursing-home places**
for 28 million people, so a coordination layer is not a convenience over a care
system - it is the only realistic form the care system takes.

## DONE (2026-09-18): the television answers the remote

`/tv` had **no keyboard handling anywhere in `sim-ui`** - not a focus ring, not a
key listener. A D-pad press did nothing. Organisers explicitly ask for voice, D-pad
and visuals blended, and the surface that was supposed to prove it was read-only.

**Why this is the accessibility argument, not a control scheme.** Voice serves
someone who cannot see. The screen serves someone who cannot hear. Neither serves
someone who cannot easily **speak** - after a stroke, with advanced Parkinson's, or
simply across a room from the Echo. Before this, such a person could watch the care
board and not touch it. The remote is the third channel.

- `sim-ui/src/lib/dpad.ts` - navigation as a **pure reducer**, so "can you always get
  back out?" has a provable answer. Three modes: `ambient` (the clock) -> `browsing`
  (moving between gaps) -> `identifying` (who is taking this on).
- `src/dpad.test.ts` - 10 tests in the main suite (**219 total**), including that
  every mode can be backed out of and that a gap list shrinking under the viewer
  never leaves focus past its end (the board polls every 4s; someone else can claim
  the focused gap mid-press).

**The middle rung is the design.** OK never claims directly - it asks **who**. A
remote in a living room carries no identity; the television cannot know which of
four people pressed the button, and CareCircle binds identity to a credential and
never infers it. Claiming in someone's name because they were nearest the remote is
assumption-as-fact, which is the one thing this product exists to refuse.

**Margaret is on the chooser but is never the default** (she is a participant in her
own care, not a subject of it) - caught in review, because a viewer pressing OK
twice quickly would otherwise have assigned work in the care recipient's name
without ever choosing her.

**Gotchas:** Back arrives as `Escape` on some Fire TV builds and `Backspace` on
others, and an unhandled Backspace navigates the WebView out of the app - both are
mapped. Every recognised key calls `preventDefault`. Focus is never carried by a
glow alone: the focused card also reads **"> Selected - 2 of 3"**, because at ten
feet, and for a colour-blind viewer, the word is what communicates.

Verified in-browser at 1600x900, locally and then **against the live `/tv`**: wake,
wrap, choose, and the failure path rendering honestly as *"Couldn't claim that:
HTTP 500"* rather than a false success. The live check was deliberately backed out
without claiming - the shared board is what every visitor sees.

## The deploy deleted secrets it was not given (2026-09-18)

Worth reading before the next deploy. `update-service` **replaces** the whole
`RuntimeEnvironmentVariables` map instead of merging into it. A deploy run from a
shell that had not sourced `.env` therefore removed `CARECIRCLE_OAUTH_SECRET` and
`RING_HMAC_KEY` from the running service. The build succeeded, the image was
correct, the script printed "not set (feature stays off)" - and account linking
would simply have stopped working.

`deploy-mcp.sh` now reads the service's current environment first and treats it as
the floor, so an unset variable is a variable **left alone**, and the summary line
distinguishes "set from this shell" from "kept from the running service (not in
this shell - did you source .env?)". Restored and re-verified: `identity: "jwt"`,
OAuth discovery 200, Ring unsigned 401 (503 would mean the key was missing).

## Front-end (judge-facing UI) - React + Vite + Tailwind + R3F

The UI was migrated off vanilla HTML to a real build in **`sim-ui/`** (React 18 + Vite +
Tailwind + React Three Fiber). One design system (tokens in `tailwind.config.js`), three
client routes served as an SPA by the sim Express server (`src/sim/app.ts` serves
`sim-ui/dist` with a non-`/api` GET fallback to `index.html`):
- **`/`** - Hero: R3F scene (distorted core + four evidence surfaces + bezier evidence
  streams + drei `Html` labels), live Care-Gap badge from `/api/state`.
- **`/console`** - voice console: **Amazon Transcribe** (default) or `SpeechRecognition`
  in, `SpeechSynthesis` out, member selector, device orb with listening state, live board
  with real `claim_obligation` / `confirm_proposal` / `confirm_purchase` actions via
  `/api/act`, tool-call log. See "Voice accuracy" below.
- **`/tv`** - 10-foot care board.
- Dev: `cd sim-ui && npm run dev` (Vite :5174 proxies `/api` → sim :5173). Build: the
  Dockerfile runs `cd sim-ui && npm ci && npm run build` and ships `sim-ui/dist`.
- **Legacy** `public/*.html` (old `index.html`/`console.html`/`tv.html`) are still served
  as static fallbacks. The Fire TV APK now loads the React `/tv` route (repointed in
  `firetv/app/src/main/java/com/carecircle/tv/MainActivity.java`), so it shows the
  current board with the score decomposition, not the legacy static page. Rebuild the
  signed APK with `cd firetv && ./gradlew :app:assembleRelease`
  (-> `app/build/outputs/apk/release/app-release.apk`).

## Ambient TV surface (2026-09-18) - the "shared display" as TV content

The Fire TV surface was reworked from a 3-column dashboard into an **ambient TV
screen**: a big clock/date over which care gaps arrive as **sliding notification
cards** (the way a TV OS surfaces an alert), not a board a family reads. It is one
**real React Native** component shared across Fire TV / Android TV / Apple TV and web:

- Source: `firetv/packages/shared-ui/src/screens/CareCircleScreen.tsx` (RN
  `Animated` slide-in; polls the live `/api/state` every 4s; green/red online dot).
  The sim-ui web twin is `sim-ui/src/pages/AmbientTV.tsx` (route `/tv`).
- **Hosted live** as a static Expo web export at **`/tv-native/`** on the sim. Built
  with `EXPO_BASE_URL`/`experiments.baseUrl = /tv-native` so every asset path is
  self-contained, exported to `public/tv-native/`, and served by the sim's existing
  static middleware (no code change). Re-export:
  `cd firetv/apps/expo-multi-tv && npx expo export -p web --output-dir dist-web`
  then `cp -R dist-web/. ../../../public/tv-native/`, commit, redeploy.
- **CORS:** the sim now sends `Access-Control-Allow-Origin: *` on all responses
  (`src/sim/app.ts`), so the RN web build fetches `/api/state` cross-origin during
  `yarn dev:web` (localhost:8082). Without it the screen renders but the dot stays
  red and no notifications appear.
- **Gotchas fixed:** (a) the sample's `scaledPixels` returns 0 on web, so sizing uses
  `useWindowDimensions` and `s = n => n*width/1920`; (b) the notification froze after
  one slide-out when only ONE gap was live (`idx % 1` never advanced) - now driven by
  a monotonic cycle counter so it loops with one gap or many.
- **APK is a stretch goal, not built for this surface.** The web export IS the demo;
  producing the Fire OS APK (expo-multi-tv Android build) is deferred unless a rule
  requires the app installed on physical Fire TV.

## Live resources

- MCP server: `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp` (health: `/health`,
  now reports `identity: "jwt"`)
- Ring webhook: `https://ypq2dfq2p7.us-east-1.awsapprunner.com/ring/webhook`
  (401 unsigned, 200 signed - both verified live)
- OAuth: `/oauth/authorize`, `/oauth/token`, discovery at
  `/.well-known/oauth-protected-resource` (200 live)
- Simulator (judge-facing UI): `https://krqi2tpsif.us-east-1.awsapprunner.com`
- Ambient TV surface (real React Native, web build): `https://krqi2tpsif.us-east-1.awsapprunner.com/tv-native/`
- Reproduce end-to-end with no AWS/keys: `npm ci && npm run story`
- Measured claims: `npm run evals` (93.3% tool selection), `npm run trust-benchmark`
  (raw LLM 50% false accusation vs CareCircle 0%)

## Operational rules (important)

- **Git author must be `Osiyomeoh <samuelaleonomoh5@gmail.com>` - no Co-Authored-By
  lines, no Claude as a contributor.** (Git config already set correctly.)
- **Deploy uses the `conductor` AWS profile** (the default session identity lacks App
  Runner permissions). Both services run on one shared ECR image tagged `:latest`;
  `AutoDeployments` is off. **CRITICAL: BOTH services need an explicit `start-deployment`
  after a build.** `deploy-mcp.sh` calls `update-service` on `carecircle-mcp`, but because
  the image URI (`:latest`) is unchanged that call is a no-op and App Runner does NOT pull
  the new image - so `carecircle-mcp` silently keeps serving the old code (this bit us:
  live `/api/state` gap text lagged the repo by a day). Full sequence:
  - `AWS_REGION=us-east-1 AWS_PROFILE=conductor ./infra/deploy-mcp.sh` (builds+pushes
    image via CodeBuild)
  - MCP: `AWS_PROFILE=conductor aws apprunner start-deployment --service-arn arn:aws:apprunner:us-east-1:287977321648:service/carecircle-mcp/26c6192211474f7fa04ff8d8cb759424 --region us-east-1`
  - sim: `AWS_PROFILE=conductor aws apprunner start-deployment --service-arn arn:aws:apprunner:us-east-1:287977321648:service/carecircle-sim/399940e7f6f54ef9a02e7d39cf93addf --region us-east-1`
  - `/api/state` is proxied by the sim to the MCP server's `carecircle://household/state`
    resource, so gap/obligation TEXT changes only go live once **carecircle-mcp** redeploys.
  - Deploy builds from committed `HEAD` (`git archive HEAD`), so **commit before deploying.**
  - **Latent bug, fixed 2026-09-18:** `deploy-mcp.sh` wrote the App Runner *instance
    role* policy only when creating the role, so it had been frozen at its original
    DynamoDB+SNS permissions since day one - any permission added later silently never
    applied. The policy is now rewritten on **every** deploy, and includes `transcribe:*`.

## DONE (2026-09-17): Fire TV app - the "shared display" surface

**Status: built and verified.** The Fire OS (Android) React Native app ships as
`firetv/` (clone of `AmazonAppDev/react-native-multi-tv-app-sample`, nested `.git`
removed so it tracks as normal source). What was done:

- **CareBoard screen** replaces the sample movie home screen:
  `firetv/packages/shared-ui/src/screens/HomeScreen.tsx`, backed by
  `firetv/packages/shared-ui/src/data/careState.ts`. Polls the SAME live
  `/api/state` every 4s (no new backend) and renders three columns - **Care Gaps**,
  **Owned**, **Proposed** - at 10-foot scale, each card carrying the
  CONFIRMED / INFERRED / NO RECORD provenance chip. D-pad focusable via
  `react-tv-space-navigation`. Drawer label renamed to "Care Board".
- **Debug APK built green:** `firetv/apps/expo-multi-tv/android/app/build/outputs/apk/debug/app-debug.apk`
  (~128 MB, package `com.anonymous.MultiTVSample`). `aapt2` confirms it is a real TV
  app - `leanback-launchable-activity`, `touchscreen` not-required - i.e. exactly the
  APK the Amazon Appstore submission form wants. Rebuild:
  `cd firetv/apps/expo-multi-tv && EXPO_TV=1 npx expo prebuild --platform android --clean && cd android && ./gradlew assembleDebug`
  (the generated `android/`, `ios/`, `node_modules/` are gitignored by the starter).
- **Verified rendering** via the Expo web target (same shared-ui code) at 1280×720
  against the live seeded state: all 3 gaps, both amber NO RECORD chips + the purple
  INFERRED ride, and the INFERRED proposal render correctly. `careState.ts` honors
  `EXPO_PUBLIC_CARE_API_BASE` so a local CORS proxy can front the live sim for web dev
  (the deployed sim serves `/api/state` without CORS headers); no effect on the APK.
- **Live board seeded** (pending item #4, done): via the sanctioned `/api/act` API -
  `record_appointment` cardiology (Renee) → 2 INFERRED proposals; `confirm_proposal`
  the ride (David) → OPEN unowned Care Gap. Combined with the already-seeded meds,
  the board now opens on 3 Care Gaps (2 NO RECORD, 1 INFERRED) + 1 INFERRED proposal.
  Matches the video's opening state (ride confirmed but unclaimed - claimed on camera).

**Emulator note (blocker, not fixed):** the pre-existing `Medium_Phone_API_35` AVD's
system image is corrupt (metadata only, no `system.img`) and there is no `sdkmanager`
installed (no `cmdline-tools/`), so the emulator won't boot to screenshot the APK live.
To fix when a real Fire TV/emulator capture is wanted: install cmdline-tools, then
`sdkmanager "system-images;android-35;google_apis_playstore;arm64-v8a"` (arm64 for this
Apple-Silicon Mac; the `android-tv` images are x86-only and slow here), recreate the AVD,
`adb install` the APK above. The APK itself is done and correct.

---

**Original decision (kept for context):** build the **Fire OS (Android) React Native** app, NOT Vega. Reason: the
Android toolchain is already installed on this machine (Java 17, Android SDK at
`~/Library/Android/sdk`, adb, emulator, ndk, watchman, Node 24) and it yields a real
**APK** - the exact file the Amazon Appstore "New App Submission" form wants. Vega would
need the large, login-gated Vega SDK + Vega Virtual Device; skip unless we specifically
want Vega OS.

**What the app IS:** the ambient care board on the living-room TV - the fourth surface in
"four surfaces, one system." No new backend. It fetches the SAME MCP resource the web
console reads and renders it 10-foot / glanceable: today's Care Gaps, who owns what, and
the CONFIRMED / INFERRED / NO RECORD provenance chips. This makes Fire TV a *real entered
track*, not a seam.

**Data source (already live, no auth):**
`GET https://krqi2tpsif.us-east-1.awsapprunner.com/api/state` →
`{ gaps:[{spoken, because, kind, severity, obligationId}],
   obligations:[{id, what, status:'ASSIGNED'|'PROPOSED', owner, provenance:'CONFIRMED'|'INFERRED'|'NOT_LOGGED'}],
   offers:[{offerId, item, merchant, etaText, amountCents}],
   notifications:[{from, to, message}] }`
(Poll every ~4s, exactly like `public/console.html` does.)

**Starter:** `github.com/AmazonAppDev/react-native-multi-tv-app-sample` - a yarn@4 workspaces
monorepo (`apps/expo-multi-tv` = Android/iOS/web via Expo RN-for-TV; `apps/vega` = Vega).
For Fire OS we only need the Android/Expo workspace.

**Build steps for the fresh session:**
1. Clone the starter into the repo as `firetv/` (or `apps/firetv/`).
2. `yarn install` (large - RN/Expo deps; ~1GB). Use the Android/Expo workspace only.
3. Replace the sample home screen with a `CareBoard` screen: fetch `/api/state` from the
   live sim URL above, render Gap/owned/proposal cards + provenance chips, TV-sized type,
   focus-navigable with the D-pad (use the sample's existing focus patterns).
4. Create an Android **TV** AVD (need an `android-tv` system image via `sdkmanager
   "system-images;android-34;android-tv;x86_64"`; only `android-35` phone image is
   installed today) OR run on the existing `Medium_Phone_API_35` emulator for a quick check.
5. Build a debug APK (`./gradlew assembleDebug` under the Android project, or
   `expo run:android`). The APK is the artifact for the Appstore form / the demo.
6. Screenshot it running for the video.

**Amazon app registration** (already captured in `.env`, gitignored, non-secret):
`AMZN_APP_ID`, `AMZN_APP_RELEASE_ID`, `AMZN_APP_PUBLIC_KEY` - the Fire TV/Appstore app.
NOTE: for the hackathon a *demo-ready* app + video is enough; do NOT complete the Appstore
publication/certification flow unless we decide to. The store form needs the built APK.

**Ring (separate, user action pending):** Ring API needs the Ring Developer Portal triplet
(**Client ID, Client Secret, HMAC key**) after gov-ID identity verification - NOT the
Amazon device-app IDs above. Once the triplet arrives, wire `ingest_signal` (`server.ts:594`,
`source` enum currently `'ring'|'other'`) to the real Ring API (sandbox has synthetic data).
"Care-taking" is a named Ring priority category → this earns the Ring track.

## What we learned this session

- **The rules make honesty mandatory.** "Not just a mention in the README" for Alexa+/
  Ring/Bee. Overclaiming Ring/Bee would hurt the Alexa+ "Tech Implementation" score when
  a judge cross-checks the repo. Keep the seam framing.
- **Friction logs earn up to a 10% judging bonus** - `docs/FRICTION-LOG.md` should have a
  complete entry (task → steps → expected vs actual → severity → workaround →
  suggestion) for every tool. High leverage; verify completeness.
- **Feature requests are optional-but-scored** - added to SUBMISSION.md.
- **The demo video is the live risk.** Never imply Ring/Bee is wired. When the Ring
  delivery appears, show it as an ingested signal → INFERRED proposal.
- **UI shipped this session:** provenance chips (CONFIRMED/INFERRED/NO RECORD), a
  voice-first breathing orb, a richer one-tap purchase card, dev-meta text removed.

## Pending / next moves

Organiser update (2026-09-18): **the repo may now stay private**, provided both
`@AmazonAppDev` (GitHub account) and `testing@devpost.com` (email) have access.
Ours is already private, so the old "make it public near Oct 23" item is gone.

**P0 - this week**

1. **Repo access.** Add `AmazonAppDev` as a collaborator (CLI can do this; needs
   the user's go-ahead - it grants an outside party read access). `testing@devpost.com`
   is an EMAIL, and GitHub's collaborator API only takes usernames, so that invite
   must go through the web UI: Settings -> Collaborators -> Add people. Do it early;
   invites must be accepted and that clock is not ours.
2. ~~Modality independence as a tested invariant~~ - **DONE**, see above.
3. ~~Fire TV D-pad~~ - **DONE**, see above. It was not navigable at all.
4. **Dismiss the two zombie proposals** (needs the user's go-ahead; changes what
   every visitor sees).

**P0 - next two weeks**

5. OAuth 2.1 + PKCE is **DONE and live**; what remains is onboarding the real
   Alexa+ add-on via the Alexa AI CLI (needs the user's own Amazon login).
   Amazon now documents a self-service path plus a web simulator, so real Alexa+
   rendering our MCP App is reachable. Unknown approval turnaround is why this
   cannot slip. Latency is NOT a blocker: App Runner measures 2-10ms in-region
   against Amazon's 500ms ceiling.
6. **The <=3-minute video**, built on the delegation arc, captioned, stating the
   accessibility thesis out loud. Ring/Bee framed as seams throughout.

**P1**

7. Accessibility pass on the sim UI: screen-reader semantics on the board, verify
   provenance chips never rely on colour alone. (Polly pace control is done.)
8. Attack the 9 eval misses; publish the number either way.
9. Friction-log entries: **prompt injection via care notes** (free text flows into
   model context), **MCP cannot pass speaker identity**, and **MCP gives a server no
   way to tell the client what time it is** - the bug that produced a December 2024
   appointment. All three are real protocol observations, and friction entries carry
   up to a 10% bonus.
10. Writeup language: organisers reward "an agentic workflow that orchestrates
    across services or keeps context across sessions". That is the delegation loop
    and the persistent household state. Use their vocabulary, not ours.

**P2** - care timeline, Ring doorstep card with its `SIMULATED` badge, purchase polish.

**Explicitly not doing:** RAG on the gap-decision path (it would destroy the
determinism the trust benchmark depends on), more tools for their own sake, a
Google calendar integration.

**Still unanswered by the user:** whether the demo "play the day" surface should
make real MCP calls against the shared household (recommendation: yes, with a
visible Reset).

**Cannot be entered:** Bee only. It needs real data recorded through a Bee device
or an Apple Watch running Bee software; we have neither, so Bee stays a seam and
is never claimed as an integration. (An earlier version of this line also listed
Ring - that was wrong. The rules explicitly permit a simulator and state no
physical device is required, and we now run a real verified webhook driven by a
signed simulator. Corrected 2026-09-18.)
