# CareCircle — Devpost submission

**Primary track:** Alexa+ (MCP) · **Mini-challenges:** AWS Builder, Open Source

**Tagline:** Every other assistant tells you what happened. CareCircle tells you what
nobody has taken responsibility for — and lets you close it by voice, even buy the
fix in place, without ever turning a guess into a fact.

**Live MCP server (judge-usable until judging ends):** `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`
· health: `/health` · spec 2025-11-25, Streamable HTTP. Demo credentials below.

---

## What it does

CareCircle is an Alexa+ MCP server for a family caring for an aging relative. It turns
ordinary care signals into shared **obligations**, and surfaces the **Care Gaps** —
the ones nobody owns — so nothing falls through the cracks.

`EVENTS → OBLIGATIONS → OWNERSHIP.` Something happens, it implies work, and someone
must own that work. A Care Gap is the failure state of the third stage.

## Who it's for, and how many (market)

**~53 million** adults in the U.S. were unpaid family caregivers as of 2020, about
one in five adults — *Caregiving in the U.S. 2020*, AARP & the National Alliance for
Caregiving. Most caregiving is **shared** across siblings and a paid aide, runtime onboarding (create a household, add/remove members and medications), and the
coordination — not the tasks themselves — is where it breaks down; the same report
finds higher-hour, higher-complexity situations are rising. Narrow that to the
serviceable slice CareCircle is built for — families coordinating care for an aging
parent who lives alone, on the Amazon devices already in the home — and it is still a
multi-million-household market, reachable through the existing Alexa+ install base
rather than a new device or app the parent has to learn. The path beyond the
hackathon is concrete: an Alexa+ add-on, distributed the way Amazon distributes them.

## How it works — Build / Ship / Shape

- **Build** — the record builds itself. A spoken sentence ("I took my heart pill"), a
  constraint ("I can't drive Thursday" — which silently orphans the ride), and a Ring
  doorbell delivery all become one shared record. Nobody types a task.
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
