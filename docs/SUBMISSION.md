# CareCircle - Devpost submission

**Primary track:** Alexa+ (MCP) · **Mini-challenges:** AWS Builder, Open Source

**Tagline:** Every other assistant tells you what happened. CareCircle tells you what
nobody has taken responsibility for - and lets you close it by voice, even buy the
fix in place, without ever turning a guess into a fact.

**Live MCP server (judge-usable until judging ends):** `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`
· health: `/health` · spec 2025-11-25, Streamable HTTP. Demo credentials below.

---

## The problem, in one family

Margaret is 78 and lives alone. Her son **David**, her daughter **Renee**, and a paid
aide, **Tasha**, share her care. Nobody is in charge - so the work that falls through
the cracks is the work **nobody realised was anyone's job**. *"Nobody knew a ride to
cardiology was needed until Thursday morning."* Every family-care tool assumes someone
already noticed the work and typed a task. CareCircle starts one step earlier.

## What it does

CareCircle is an Alexa+ MCP server that turns ordinary spoken care signals into shared
**obligations**, and surfaces the **Care Gaps** - the ones nobody owns - before they
fail. It does two things no other assistant does:

- **The cared-for person is a participant, not a patient on a dashboard.** Margaret,
  who has never used a smartphone, **logs her own care by talking.**
- **It refuses to lie.** A missing record is surfaced as *"there's no record,"* never
  *"she missed it"* - a rule enforced in the type system and the tests.

And a Care Gap can be closed by voice, or **fixed by buying the thing in place** -
reorder the prescription right in the conversation.

- **It doesn't stop at noticing.** CareCircle **asks a named person**, remembers that
  being asked is not the same as having agreed, and asks the next person when the
  first declines - until the work has an owner.

`EVENTS → OBLIGATIONS → OWNERSHIP.` Something happens, it implies work, and someone
must own that work. A Care Gap is the failure state of the third stage.

## It's real - not a mockup

The judges' own advice is to beware glossy vapor. CareCircle is the opposite:

- A **live MCP server** a judge can hit now (Streamable HTTP, spec 2025-11-25).
- **209 automated tests**, strict TypeScript, an adversarial suite, CI.
- Tool selection **measured at 93.3%** (126/135, half of them held out) on Amazon
  Bedrock - `npm run evals`, and it reproduces.
- The trust model **measured**: a raw Sonnet 4.5 turns a missing dose into "she missed
  it" **50%** of the time; CareCircle **0%** - `npm run trust-benchmark`.
- Reproduce the whole one-day story end-to-end with **no AWS or keys**: `npm ci && npm run story`.

## What's built vs. what's an adapter seam (no overclaiming)

The architecture is bigger than any one surface - but we are precise about the line
between running code and a designed contract. MCP is the seam: it is what lets entirely
different surfaces feed one shared responsibility system.

**Built and tested (live code):**
- Alexa+ MCP server - Streamable HTTP, spec 2025-11-25, **21 tools**, session-bound identity.
- The Care Gap engine - `EVENTS → OBLIGATIONS → OWNERSHIP`, deterministic, never narrated by a model.
- The trust / provenance model - `CONFIRMED` / `INFERRED` / `NOT_LOGGED`, enforced in the type system and tests (**Known ≠ Assumed**).
- `ingest_signal` - the generic external-signal tool: any physical or wearable event becomes an `INFERRED` proposal a human must confirm. **This is the Ring and Bee seam, and it runs today.**
- Ownership / claiming / assignment, purchase-in-place (`reorder_prescription` / `confirm_purchase`), multi-person identity, SNS notifications (record-only fallback), DynamoDB persistence, App Runner deployment.
- The shared multi-device board (the simulator) - the same view a Fire TV would render.
- **209 tests**, adversarial suite, CI.

- **The delegation loop** - `request_owner` / `respond_to_request` / `get_my_requests`.
  `REQUESTED` is its own status and **carries no owner**: being asked is not having
  agreed, and collapsing those is the same class of error as reading a missing
  medication record as a missed dose. A pending ask earns a *discount*, not an
  exemption - relief decays as `0.55 · e^(-hours/12)`, so "I asked David" quietly
  becoming "nobody is doing this" is visible in the arithmetic.
- **Ring, on a real verified webhook** - `POST /ring/webhook`, implementing Ring's
  published Partner API contract: HMAC-SHA256 over the **raw** body in `X-Signature`
  (mounted before `express.json`, because parse-then-restringify breaks the MAC),
  idempotency on `meta.request_id`, 200 within five seconds. Unsigned bodies are
  rejected before parsing. Driven by `npm run ring:simulate`, which signs with the
  real partner HMAC key - so what is simulated is the *device*, and what is exercised
  is the *integration*. The rules explicitly permit a simulator and require no
  physical device.
- **OAuth 2.1 + PKCE (S256)** - RFC 9728 / RFC 8414 discovery, single-use codes burned
  on failed exchange, HS256 enforced. This is what lets Alexa+ link the add-on to a
  real person rather than a demo token.
- **Amazon Polly and Amazon Transcribe** - identical voice on every judge's machine,
  and a listener-chosen speech **pace** - speed and breath together - which is an accessibility
  requirement, not polish.

**Adapter-ready (seam built, no live third-party wiring):**
- **Bee** (wearable context) → `ingest_signal`. Same seam; **deliberately gated** - Bee
  requires real data recorded through a Bee device or an Apple Watch running Bee
  software. We have neither, so we never claim it as an integration.
- **Fire TV** → the web board is the presentation surface; there is no Fire-TV-specific app.

Everything a device contributes crosses the same contract: `CareEvent → engine → Obligation → Care Gap`. `Evidence ≠ Obligation ≠ Ownership` - a Ring event never auto-becomes "Mom got her prescription," and an absent record never becomes "Mom didn't take it."

## Who it's for, and how many

Every figure here is sourced and marked PRIMARY / SECONDARY / CONTESTED in
[EVIDENCE.md](EVIDENCE.md). **We apply our own trust model to our own claims** - it
would be incoherent to build a system that refuses to state an inference as a fact and
then argue for it with unsourced numbers.

**The population.** 1.4 billion people will be 60+ by 2030, 2.1 billion by 2050 (WHO).

**The mechanism.** Around **50% of patients do not take long-term medication as
prescribed** (WHO, 2003), and **1 in 5** older adults has skipped needed care for lack
of transport. **53%** of US family caregivers say someone else also provides unpaid
help to the same person (AARP/NAC 2020) - shared responsibility with no owner is
exactly the failure state CareCircle detects. A cardiology appointment nobody drives
the patient to is not a scheduling problem; it is a missed appointment.

**The economy.** **16.4 billion hours** of unpaid care work are performed daily
worldwide - the equivalent of 2 billion people working full-time, unpaid - valued at
up to **9% of global GDP, about US$11 trillion** (ILO, 2018). Women perform 76.2% of
it. The world's largest care workforce is unpaid, uncoordinated, and has **no shared
system of record**. An $11 trillion economy runs on memory and text messages.

**Where the case is strongest.** In the West this is a convenience layer over an
existing care system. In Nigeria - where I am from - and across Sub-Saharan Africa
**there is no such system to sit on top of**. Formal long-term care is largely
undeveloped (World Bank); **Cameroon has fewer than 50 nursing-home places nationally
for 28 million people** (JAMDA, 2025). Nigeria has the largest older population in
Africa, projected at **25.3 million aged 60+ by 2050**. Urbanisation and migration mean
support arrives as **remittances rather than presence**: a parent in the village, one
child in Lagos, one abroad, a paid aide on shift. That distributed family is not a
persona we invented - it is the documented default structure of African elder care, and
it is precisely the shape CareCircle is built for.

A calendar assumes everyone can see it. A care-management platform assumes an
institution is paying for it. Neither assumption holds. **Voice on a shared device,
with a screen anyone in the room can glance at, assumes only that a family talks to
each other.**

The distribution path is concrete and needs no new hardware: an Alexa+ add-on on
devices already in the home.

## How it works - Build / Ship / Shape

- **Build** - the record builds itself. A spoken sentence ("I took my heart pill"), a
  constraint ("I can't drive Thursday" - which silently orphans the ride), and a
  physical-world delivery event (a Ring package, ingested through the `ingest_signal`
  tool) all become one shared record. Nobody types a task. Crucially, a delivery enters
  as *evidence* - "a package arrived," an `INFERRED` proposal - never as the asserted
  fact "the prescription came"; a human confirms before it counts.
- **Ship** - the work gets done. "What's going to fall through the cracks this week?"
  surfaces the unowned items; a caregiver claims one by voice, and reorders a
  prescription with a **rich purchase card confirmed in place** - the Care Gap closes
  the instant the order is placed.
- **Shape** - the system shapes the family by refusing to lie. A missing evening dose
  is surfaced as *"there's no record"* - never *"she missed it."* **Known ≠ Assumed**
  is enforced in the type system and the tests, not just the copy.

## Accessibility is the architecture, not a pass at the end

Over **1.5 billion** people live with some hearing loss; **at least 2.2 billion** have
vision impairment - and both burdens concentrate in exactly the 60+ population this
product exists for (WHO). A care system delivered only by voice excludes a group
counted in billions. So does one delivered only by screen.

So **modality independence is an architectural invariant with a test on each half**
(`src/modality.test.ts`):
- the spoken answer never says "tap", "click" or "below" - the screen can never become
  required, so a blind listener has full access;
- every fact a gap carries - `spoken`, `because`, `kind`, `severity`, `score`,
  `factors` - is present in the board's structured data, so voice can never become
  required and a deaf reader has full access.

And the television answers the **remote**, which is the third channel: voice serves
someone who cannot see, the screen serves someone who cannot hear, and neither
serves someone who cannot easily **speak** - after a stroke, with advanced
Parkinson's, or simply across a room from the Echo. A D-pad closes that gap. The
navigation is a pure reducer (`sim-ui/src/lib/dpad.ts`) with its own tests, and OK
never claims directly - **it asks who is taking this on**, because a remote in a
living room carries no identity and this system never infers one.

Neither channel is allowed to become load-bearing, and the build fails if one does.
Polly's pace control - speed and pause length together - exists for older listeners, people with
hearing loss, and anyone processing language after a stroke.

## What is creative here (the rubric's own examples, met)

Amazon's Alexa+ "creative" list names: *agentic orchestration across services,
context-aware state across sessions, purchasing capabilities, media support (cards).*
CareCircle has all four - plus one original mechanic judges won't have seen: surfacing
**unowned responsibility** and closing it by voice or purchase under a trust model that
won't assert an inference.

## Significantly updated during the submission period

Built new during the window. Highlights added this period: the purchase-in-place flow
(`reorder_prescription` / `confirm_purchase`), the tool-selection eval harness and its
published accuracy, production hardening (config validation, structured logging,
graceful shutdown, DynamoDB persistence, App Runner deployment), runtime onboarding (create a household, add/remove members and medications), and the
`@carecircle/care-events` open-source package.

## How well it's built

- MCP spec **2025-11-25** over **Streamable HTTP**; 21 tools, session-bound identity
  (a member's credential, never the conversation, decides who they are).
- **Measured tool selection: 93.3% first-tool accuracy (126/135)** on Claude Sonnet 4.5
  via Bedrock, over 68 authored cases plus **67 held-out cases never tuned against**.
  Reproducible: `npm run evals`.

  **On re-running it.** The headline reproduces exactly; the split between the two
  halves does not, because the model is sampled rather than deterministic. Our
  latest run was 67/68 authored and 59/67 held-out (98.5% / 88.1%); an earlier one
  was 68/68 and 58/67 (100% / 86.6%). Same total, different halves. We report the
  number a judge will actually get and name the variance rather than quoting our
  best run - the arithmetic that ranks someone's care is deterministic, but the
  language model choosing the tool is not, and those are different claims.
- **Measured trust model: a raw Sonnet 4.5 turns a missing record into a false
  accusation ("she missed it") in 50% of absence cases; CareCircle's deterministic
  engine, 0%** - the same model, the same scenarios, every answer auditable.
  Reproducible: `npm run trust-benchmark`. This is the differentiator, quantified.
- **209 automated tests** incl. an adversarial suite (credential swap mid-session,
  cross-household access, prompt-injection through note text), strict TypeScript, CI.
- Deterministic end-to-end demo over real MCP: `npm run story`.

## Product feedback (per tool - required, and we mean it)

**MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.0)** - *used for* the server,
Streamable HTTP transport, tools/resources/prompts. *Worked:* the transport and session
model are clean; `registerTool` with Zod schemas is pleasant. *Needs work:* no published
spec-version support matrix (had to grep compiled source for `LATEST_PROTOCOL_VERSION`);
transports are not assignable to `Transport` under `exactOptionalPropertyTypes` without a
cast; "Server not initialized" errors are opaque. *Onboarding:* fast to hello-world.
*Again?* Yes.

**Amazon Bedrock (Claude Sonnet 4.5)** - *used for* the Alexa+ planner (NL → tool
selection) and as the AWS Builder integration. *Worked:* `Converse` is simple; Sonnet
4.5 tool selection is strong (93.3%). *Needs work:* a model-access grant does not imply
the caller has `bedrock:InvokeModel` (two independent gates, identical-looking errors);
the newer models must be called by inference-profile id, not model id; you can't
self-diagnose quota headroom without a separate Service Quotas permission. *Onboarding:*
slow - access + IAM + inference-profile were three separate hurdles. *Again?* Yes.

**AWS App Runner + CodeBuild + ECR** - *used for* one-command cloud build and a public
HTTPS URL with no local Docker. *Worked:* App Runner health checks + auto-TLS are
excellent for a judge-usable URL. *Needs work:* role propagation delays force `sleep`s in
the deploy script. *Again?* Yes.

**Amazon DynamoDB** - *used for* the care record (single-table, household-partitioned,
diff-based writes). *Worked:* on-demand billing and the single-table model fit the
household boundary, which is also the auth boundary. *Again?* Yes.

**Ring Partner API** - *used for* the physical-world signal (a delivery becomes
evidence, never a conclusion), on a real signed webhook. *Worked:* the security
contract (raw-body HMAC + `request_id` idempotency) is the right one. *Needs work:*
event types are listed but the payload JSON **schema** is not, so we modelled
defensively - we read package delivery from `attributes.sub_type`, and whether
`package` is a real sub_type is **still unconfirmed**; and the OAuth **redirect URI**
Ring will use is not published anywhere we could find, so we cannot pre-register an
allowlist without risking rejecting Ring's own linking. *Again?* Yes.

**Amazon Polly** - *used for* every spoken reply, and for listener-controlled pace.
*Worked:* generative Ruth is identical on every machine, which is why a judge hears
what we heard. *Needs work:* `polly:DescribeVoices` is a separate permission from
`polly:SynthesizeSpeech`, so voice discovery fails while synthesis works. *Again?* Yes.

**Amazon Transcribe** - *used for* speech in, with the household's own names as a
custom vocabulary. *Needs work:* a vocabulary already in `READY` is never refreshed,
so it silently freezes at whatever the household looked like on first boot; we now
diff a phrase-set signature and rebuild on drift. *Again?* Yes.

## Feature requests (concrete, prioritized)

The full set - 17 requests and 20 friction entries, each with task, steps, expected vs
actual, severity and workaround - is in [FEATURE-REQUESTS.md](FEATURE-REQUESTS.md) and
[FRICTION-LOG.md](FRICTION-LOG.md). The highest-leverage ones:

Distinct from the feedback above: specific things that, had they existed, would have
saved us hours - each one hit while building CareCircle this period.

1. **MCP SDK - a published protocol-version support matrix.** We had to grep compiled
   source for `LATEST_PROTOCOL_VERSION` to know which spec revision the SDK negotiates.
   A documented table (SDK version → protocol versions supported) belongs in the README.
2. **MCP SDK - actionable transport errors.** "Server not initialized" gives no hint that
   the client skipped the `initialized` notification. Name the missing step in the error.
3. **MCP SDK - `Transport` assignable under `exactOptionalPropertyTypes`.** Today the
   built-in transports need a cast to satisfy their own interface in strict TS. Fix the
   optional-property typing so no cast is required.
4. **Bedrock - one gate, or two clearly distinct errors, for model access vs.
   `bedrock:InvokeModel`.** A granted model that still 403s on invoke, with an
   identical-looking error, cost us the most time of anything in the build.
5. **Bedrock - surface the required inference-profile id in the access-grant UI.** The
   newer models reject the plain model id; nothing in the console told us to switch.
6. **Bedrock - a read-only "can I invoke X right now?" preflight** (quota + IAM + access
   in one call), so an agent can self-diagnose before the first token is spent.
7. **App Runner - a role-readiness signal instead of propagation `sleep`s.** Our deploy
   script sleeps to wait out IAM role propagation; an "IAM ready" wait condition or a
   clear retryable error would make deploys deterministic.
8. **Ring - a published payload JSON schema per event type**, not just the event-type
   list, so integrators stop modeling defensively against undocumented shapes.

## AWS Builder mini - which services, how, why

- **Bedrock (Sonnet 4.5)** is the planner that turns a spoken sentence into a tool call
  - the reasoning core, measured at 93.3%.
- **DynamoDB** is the durable care record (single-table, diff-based writes).
- **App Runner + CodeBuild + ECR** build and serve the MCP server at a public URL.
- **SNS** delivers `notify_member` messages for real (record-only fallback otherwise).
- **CloudWatch** budget alarm keeps the deployment alive to judging without runaway cost.

Why this shape: it is a genuine **multi-service pipeline** (planner → engine → store →
delivery → observability), not a single Bedrock call.

## Open Source mini

`@carecircle/care-events` - a new, standalone, MIT-licensed, zero-dependency package
that extracts the adapter-seam pattern (one `CareEvent` contract any device plugs into,
with a provenance trust model). Details, what/how/why, and publish steps in
[OPEN-SOURCE.md](OPEN-SOURCE.md).

## Demo credentials (the identity model in miniature)

| Member | Bearer token |
|---|---|
| Margaret (care recipient) | `margaret-token` |
| David (primary caregiver) | `david-token` |
| Renee (caregiver) | `renee-token` |
| Tasha (paid aide) | `aide-token` |

## Links

- Code: `https://github.com/Osiyomeoh/carecircle` - **private**, which the organisers
  confirmed on 2026-09-18 is permitted provided `@AmazonAppDev` (GitHub) and
  `testing@devpost.com` (via the web UI - the collaborator API takes usernames only)
  both have access. MIT.
- Video: `<YouTube/Vimeo link>` (≤ 3:00)
- Live MCP: `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`

## Three protocol observations MCP itself should hear

These are not product gripes; they are gaps in the protocol that cost us real bugs.

1. **MCP gives a server no way to know what time it is.** This produced a live medical
   record dated **19 December 2024**: the planner was never told today's date, so it
   invented a timestamp near its own training prior - with no timezone. The date was
   fiction and the engine faithfully phrased it. Fixed with three guards, but a host
   ought to be able to state the current instant and the user's zone.
2. **MCP cannot pass speaker identity.** In a room with four people, the protocol
   carries no notion of *who is talking*. We bind identity to a credential per session
   instead, which is correct but is our invention, not the protocol's.
3. **Free text from tool results flows into model context**, so a care note is an
   injection surface. There is no standard way for a server to mark a span as
   untrusted data rather than instruction.
