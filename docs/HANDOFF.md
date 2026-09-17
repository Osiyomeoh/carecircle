# CareCircle - session handoff

A self-contained brief to resume work in a new session. Last updated 2026-09-17
(Fire TV app BUILT - CareBoard shipped, debug APK green, live board seeded).

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
  2025-11-25, Streamable HTTP, called in code (18 tools), live URL. Top-prize track.
- **Mini challenges: AWS Builder + Open Source.** Both qualify (Bedrock/DynamoDB/App
  Runner/SNS documented; `@carecircle/care-events` MIT package). A project can **win
  only one mini prize**, but entering both is allowed.
- **Ring and Bee are NOT enterable - this is a hard rule, not a choice.** To enter Ring
  you must show it working through a Ring simulator/device; to enter Bee you must show
  live Bee data in code + video. We do neither. `ingest_signal` is a **generic seam**,
  not a Ring API call or live Bee feed. So Ring/Bee stay framed as *architecturally-
  ready adapter seams*, never as track entries or live integrations.
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

**Built + tested (live code):** Alexa+ MCP server (18 tools, session-bound identity),
Care Gap engine (deterministic; severity is a stated risk model, see below),
trust/provenance model, `ingest_signal` (the real
Ring/Bee seam - any external signal → INFERRED proposal), ownership/claiming,
purchase-in-place (`reorder_prescription` / `confirm_purchase`), SNS notifications
(record-only fallback), DynamoDB persistence, App Runner deploy, the multi-device web
board (simulator), 87 tests + adversarial suite + CI.

**Adapter-ready (seam only, no live third-party wiring):** Ring → `ingest_signal`
(Ring's payload schema is unpublished - see FRICTION-LOG.md); Bee → `ingest_signal`
(deliberately gated); Fire TV → the web board would render there.

## Front-end (judge-facing UI) - React + Vite + Tailwind + R3F

The UI was migrated off vanilla HTML to a real build in **`sim-ui/`** (React 18 + Vite +
Tailwind + React Three Fiber). One design system (tokens in `tailwind.config.js`), three
client routes served as an SPA by the sim Express server (`src/sim/app.ts` serves
`sim-ui/dist` with a non-`/api` GET fallback to `index.html`):
- **`/`** - Hero: R3F scene (distorted core + four evidence surfaces + bezier evidence
  streams + drei `Html` labels), live Care-Gap badge from `/api/state`.
- **`/console`** - voice console: `SpeechRecognition` in + `SpeechSynthesis` out, member
  selector, device orb, live board with real `claim_obligation` / `confirm_proposal` /
  `confirm_purchase` actions via `/api/act`, tool-call log.
- **`/tv`** - 10-foot care board.
- Dev: `cd sim-ui && npm run dev` (Vite :5174 proxies `/api` → sim :5173). Build: the
  Dockerfile runs `cd sim-ui && npm ci && npm run build` and ships `sim-ui/dist`.
- **Legacy** `public/*.html` (old `index.html`/`console.html`/`tv.html`) are still served
  as static fallbacks. The Fire TV APK now loads the React `/tv` route (repointed in
  `firetv/app/src/main/java/com/carecircle/tv/MainActivity.java`), so it shows the
  current board with the score decomposition, not the legacy static page. Rebuild the
  signed APK with `cd firetv && ./gradlew :app:assembleRelease`
  (-> `app/build/outputs/apk/release/app-release.apk`).

## Live resources

- MCP server: `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp` (health: `/health`)
- Simulator (judge-facing UI): `https://krqi2tpsif.us-east-1.awsapprunner.com`
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

1. Push commit `97b0f7a` (SUBMISSION Built-vs-seam section) to origin if not already.
2. ~~Audit `FRICTION-LOG.md` for the 6 required fields per tool~~ **DONE** - all 14
   entries carry Task/Steps/Expected/Actual/Severity/Workaround/Suggestion (verified
   programmatically). The Gemini and preflight entries were completed.
3. Write the ≤3-min demo script matched to the live UI, Ring/Bee framed honestly.
4. Optional: seed the live board so judges land on populated Care Gaps + chips (right
   now it reads "nothing outstanding"). Changes what every visitor sees - confirm first.
5. Consider the top-line positioning rewrite ("responsibility layer for family care")
   across README/SUBMISSION openers - bigger, subjective; confirm before doing.
