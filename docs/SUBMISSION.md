# CareCircle — Devpost submission

**Primary track:** Alexa+ (MCP) · **Mini-challenges:** AWS Builder, Open Source

**Tagline:** Every other assistant tells you what happened. CareCircle tells you what
nobody has taken responsibility for — and lets you close it by voice, even buy the
fix in place, without ever turning a guess into a fact.

**Live MCP server (judge-usable until judging ends):** `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`
· health: `/health` · spec 2025-11-25, Streamable HTTP. Demo credentials below.

---

## The problem, in one family

Margaret is 78 and lives alone. Her son **David**, her daughter **Renee**, and a paid
aide, **Tasha**, share her care. Nobody is in charge — so the work that falls through
the cracks is the work **nobody realised was anyone's job**. *"Nobody knew a ride to
cardiology was needed until Thursday morning."* Every family-care tool assumes someone
already noticed the work and typed a task. CareCircle starts one step earlier.

## What it does

CareCircle is an Alexa+ MCP server that turns ordinary spoken care signals into shared
**obligations**, and surfaces the **Care Gaps** — the ones nobody owns — before they
fail. It does two things no other assistant does:

- **The cared-for person is a participant, not a patient on a dashboard.** Margaret,
  who has never used a smartphone, **logs her own care by talking.**
- **It refuses to lie.** A missing record is surfaced as *"there's no record,"* never
  *"she missed it"* — a rule enforced in the type system and the tests.

And a Care Gap can be closed by voice, or **fixed by buying the thing in place** —
reorder the prescription right in the conversation.

`EVENTS → OBLIGATIONS → OWNERSHIP.` Something happens, it implies work, and someone
must own that work. A Care Gap is the failure state of the third stage.

## It's real — not a mockup

The judges' own advice is to beware glossy vapor. CareCircle is the opposite:

- A **live MCP server** a judge can hit now (Streamable HTTP, spec 2025-11-25).
- **87 automated tests**, strict TypeScript, an adversarial suite, CI.
- Tool selection **measured at 93.3%** (held-out) on Amazon Bedrock — `npm run evals`.
- The trust model **measured**: a raw Sonnet 4.5 turns a missing dose into "she missed
  it" **50%** of the time; CareCircle **0%** — `npm run trust-benchmark`.
- Reproduce the whole one-day story end-to-end with **no AWS or keys**: `npm ci && npm run story`.

## What's built vs. what's an adapter seam (no overclaiming)

The architecture is bigger than any one surface — but we are precise about the line
between running code and a designed contract. MCP is the seam: it is what lets entirely
different surfaces feed one shared responsibility system.

**Built and tested (live code):**
- Alexa+ MCP server — Streamable HTTP, spec 2025-11-25, **18 tools**, session-bound identity.
- The Care Gap engine — `EVENTS → OBLIGATIONS → OWNERSHIP`, deterministic, never narrated by a model.
- The trust / provenance model — `CONFIRMED` / `INFERRED` / `NOT_LOGGED`, enforced in the type system and tests (**Known ≠ Assumed**).
- `ingest_signal` — the generic external-signal tool: any physical or wearable event becomes an `INFERRED` proposal a human must confirm. **This is the Ring and Bee seam, and it runs today.**
- Ownership / claiming / assignment, purchase-in-place (`reorder_prescription` / `confirm_purchase`), multi-person identity, SNS notifications (record-only fallback), DynamoDB persistence, App Runner deployment.
- The shared multi-device board (the simulator) — the same view a Fire TV would render.
- **87 tests**, adversarial suite, CI.

**Adapter-ready (seam built, no live third-party wiring):**
- **Ring** → `ingest_signal`. The contract is designed and the ingestion path runs; the live Ring webhook is not wired, because Ring publishes event *types* without payload *schemas* (see [FRICTION-LOG.md](FRICTION-LOG.md)).
- **Bee** (wearable context) → `ingest_signal`. Same seam; deliberately gated to keep the demo focused.
- **Fire TV** → the web board is the presentation surface; there is no Fire-TV-specific app.

Everything a device contributes crosses the same contract: `CareEvent → engine → Obligation → Care Gap`. `Evidence ≠ Obligation ≠ Ownership` — a Ring event never auto-becomes "Mom got her prescription," and an absent record never becomes "Mom didn't take it."

## Who it's for, and how many (market)

**~53 million** adults in the U.S. were unpaid family caregivers as of 2020, about
one in five adults — *Caregiving in the U.S. 2020*, AARP & the National Alliance for
Caregiving. Most caregiving is **shared** across siblings and a paid aide, and the
coordination — not the tasks themselves — is where it breaks down; the same report
finds higher-hour, higher-complexity situations are rising. Narrow that to the
serviceable slice CareCircle is built for — families coordinating care for an aging
parent who lives alone, on the Amazon devices already in the home — and it is still a
multi-million-household market, reachable through the existing Alexa+ install base
rather than a new device or app the parent has to learn. The path beyond the
hackathon is concrete: an Alexa+ add-on, distributed the way Amazon distributes them.

## How it works — Build / Ship / Shape

- **Build** — the record builds itself. A spoken sentence ("I took my heart pill"), a
  constraint ("I can't drive Thursday" — which silently orphans the ride), and a
  physical-world delivery event (a Ring package, ingested through the `ingest_signal`
  tool) all become one shared record. Nobody types a task. Crucially, a delivery enters
  as *evidence* — "a package arrived," an `INFERRED` proposal — never as the asserted
  fact "the prescription came"; a human confirms before it counts.
- **Ship** — the work gets done. "What's going to fall through the cracks this week?"
  surfaces the unowned items; a caregiver claims one by voice, and reorders a
  prescription with a **rich purchase card confirmed in place** — the Care Gap closes
  the instant the order is placed.
- **Shape** — the system shapes the family by refusing to lie. A missing evening dose
  is surfaced as *"there's no record"* — never *"she missed it."* **Known ≠ Assumed**
  is enforced in the type system and the tests, not just the copy.

## What is creative here (the rubric's own examples, met)

Amazon's Alexa+ "creative" list names: *agentic orchestration across services,
context-aware state across sessions, purchasing capabilities, media support (cards).*
CareCircle has all four — plus one original mechanic judges won't have seen: surfacing
**unowned responsibility** and closing it by voice or purchase under a trust model that
won't assert an inference.

## Significantly updated during the submission period

Built new during the window. Highlights added this period: the purchase-in-place flow
(`reorder_prescription` / `confirm_purchase`), the tool-selection eval harness and its
published accuracy, production hardening (config validation, structured logging,
graceful shutdown, DynamoDB persistence, App Runner deployment), runtime onboarding (create a household, add/remove members and medications), and the
`@carecircle/care-events` open-source package.

## How well it's built

- MCP spec **2025-11-25** over **Streamable HTTP**; 18 tools, session-bound identity
  (a member's credential, never the conversation, decides who they are).
- **Measured tool selection: 93.3% first-tool accuracy (126/135)** on Claude Sonnet 4.5
  via Bedrock — 68 authored cases at 100% plus **67 held-out cases** (never tuned
  against) at 86.6%. Reproducible: `npm run evals`.
- **Measured trust model: a raw Sonnet 4.5 turns a missing record into a false
  accusation ("she missed it") in 50% of absence cases; CareCircle's deterministic
  engine, 0%** — the same model, the same scenarios, every answer auditable.
  Reproducible: `npm run trust-benchmark`. This is the differentiator, quantified.
- **87 automated tests** incl. an adversarial suite (credential swap mid-session,
  cross-household access, prompt-injection through note text), strict TypeScript, CI.
- Deterministic end-to-end demo over real MCP: `npm run story`.

## Product feedback (per tool — required, and we mean it)

**MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.0)** — *used for* the server,
Streamable HTTP transport, tools/resources/prompts. *Worked:* the transport and session
model are clean; `registerTool` with Zod schemas is pleasant. *Needs work:* no published
spec-version support matrix (had to grep compiled source for `LATEST_PROTOCOL_VERSION`);
transports are not assignable to `Transport` under `exactOptionalPropertyTypes` without a
cast; "Server not initialized" errors are opaque. *Onboarding:* fast to hello-world.
*Again?* Yes.

**Amazon Bedrock (Claude Sonnet 4.5)** — *used for* the Alexa+ planner (NL → tool
selection) and as the AWS Builder integration. *Worked:* `Converse` is simple; Sonnet
4.5 tool selection is strong (93.3%). *Needs work:* a model-access grant does not imply
the caller has `bedrock:InvokeModel` (two independent gates, identical-looking errors);
the newer models must be called by inference-profile id, not model id; you can't
self-diagnose quota headroom without a separate Service Quotas permission. *Onboarding:*
slow — access + IAM + inference-profile were three separate hurdles. *Again?* Yes.

**AWS App Runner + CodeBuild + ECR** — *used for* one-command cloud build and a public
HTTPS URL with no local Docker. *Worked:* App Runner health checks + auto-TLS are
excellent for a judge-usable URL. *Needs work:* role propagation delays force `sleep`s in
the deploy script. *Again?* Yes.

**Amazon DynamoDB** — *used for* the care record (single-table, household-partitioned,
diff-based writes). *Worked:* on-demand billing and the single-table model fit the
household boundary, which is also the auth boundary. *Again?* Yes.

**Ring (webhook contract)** — *used for* the physical-world signal (a delivery becomes
evidence, never a conclusion). *Needs work:* event types are listed but the payload JSON
schema is not — had to model defensively. *Again?* Yes.

## Feature requests (concrete, prioritized)

Distinct from the feedback above: specific things that, had they existed, would have
saved us hours — each one hit while building CareCircle this period.

1. **MCP SDK — a published protocol-version support matrix.** We had to grep compiled
   source for `LATEST_PROTOCOL_VERSION` to know which spec revision the SDK negotiates.
   A documented table (SDK version → protocol versions supported) belongs in the README.
2. **MCP SDK — actionable transport errors.** "Server not initialized" gives no hint that
   the client skipped the `initialized` notification. Name the missing step in the error.
3. **MCP SDK — `Transport` assignable under `exactOptionalPropertyTypes`.** Today the
   built-in transports need a cast to satisfy their own interface in strict TS. Fix the
   optional-property typing so no cast is required.
4. **Bedrock — one gate, or two clearly distinct errors, for model access vs.
   `bedrock:InvokeModel`.** A granted model that still 403s on invoke, with an
   identical-looking error, cost us the most time of anything in the build.
5. **Bedrock — surface the required inference-profile id in the access-grant UI.** The
   newer models reject the plain model id; nothing in the console told us to switch.
6. **Bedrock — a read-only "can I invoke X right now?" preflight** (quota + IAM + access
   in one call), so an agent can self-diagnose before the first token is spent.
7. **App Runner — a role-readiness signal instead of propagation `sleep`s.** Our deploy
   script sleeps to wait out IAM role propagation; an "IAM ready" wait condition or a
   clear retryable error would make deploys deterministic.
8. **Ring — a published payload JSON schema per event type**, not just the event-type
   list, so integrators stop modeling defensively against undocumented shapes.

## AWS Builder mini — which services, how, why

- **Bedrock (Sonnet 4.5)** is the planner that turns a spoken sentence into a tool call
  — the reasoning core, measured at 93.3%.
- **DynamoDB** is the durable care record (single-table, diff-based writes).
- **App Runner + CodeBuild + ECR** build and serve the MCP server at a public URL.
- **SNS** delivers `notify_member` messages for real (record-only fallback otherwise).
- **CloudWatch** budget alarm keeps the deployment alive to judging without runaway cost.

Why this shape: it is a genuine **multi-service pipeline** (planner → engine → store →
delivery → observability), not a single Bedrock call.

## Open Source mini

`@carecircle/care-events` — a new, standalone, MIT-licensed, zero-dependency package
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

- Code: `https://github.com/Osiyomeoh/carecircle` (public, MIT visible in About)
- Video: `<YouTube/Vimeo link>` (≤ 3:00)
- Live MCP: `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`
