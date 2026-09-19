# From engine to product — the Monday plan

Written 2026-09-18, end of a token budget, to be picked up Monday with a running start.

## The realisation that drives this

CareCircle is, right now, an **excellent engine** and **not yet a product a customer
could use**. The deterministic gap engine, the trust model, the attribution layer, the
autonomous agent, 290 tests, live in production — that is the hard part and it is done.
But everything a *person* touches is still developer-shaped:

- The only household is **Margaret**, hard-seeded at boot. A real family cannot start
  their own circle without calling raw MCP tools by hand.
- Value is proven to *judges* (evals, benchmarks, tests). It is not yet delivered to a
  *customer* in their first five minutes.
- There is no **selling artifact** — nothing that says who this is for, what it costs,
  why a family would keep it. Amazon's own certification asks for exactly this (store
  listing: tagline, description, sample utterances) and we do not have it.

The bar for Monday, in the user's words: **"bring it to a level of something somebody
can actually use."** Not a bigger engine. A product wrapper around the engine we have.

Amazon context that matters (from the Add-ons docs, confirmed 2026-09-18):
- Alexa+ Add-ons are **apps you sell to a customer**. Think like the customer: what
  would they like, what makes them keep it, what makes them pay.
- Add-ons are pre-launch / select-partners-only, so nobody ships a live Echo
  integration this hackathon. The deliverable is an MCP server **plus the product case**.
- They want **feedback** (the friction log) — keep it, but it is not the product.

Framing note (see memory `user_nigerian_context`): lead the customer/impact case with
global and Sub-Saharan-African applicability (diaspora families coordinating care for a
parent back home is a *stronger* wedge than the US-default), not US-first.

---

## What "a customer can actually use it" means — the five gaps

Ordered by leverage. Each is a wrapper around tools that already exist; almost no new
engine work.

### 1. First-run onboarding — a real family starts their own circle (HIGHEST LEVERAGE)

Today `create_household` / `add_member` / `add_medication` exist and work, and
self-signup identity is wired (`CARECIRCLE_ALLOW_SELF_SIGNUP`, `bootstrapSubject`,
`jwtClaims({ selfSignup })`). What is missing is the *experience* that walks a person
through it without knowing a tool exists.

Build: a guided setup, conversational first (it is a voice product) with a screen
fallback in `sim-ui`. "Set up a care circle for my mum" →
  - names the person being cared for and who they are to the customer,
  - adds the other people (a sibling, a paid aide) and how to reach them,
  - adds the medications and times, one appointment,
  - and **ends on the first real Care Gap**, computed from what they just entered.

Acceptance: a stranger with no knowledge of the tools sets up a working circle for their
own family in under five minutes and sees a gap that is about *their* person, by name.

### 2. Un-seed for real use — separate the demo from the product

The hard-seeded Margaret household is right for the demo and wrong for a customer. A real
first run must start **empty** and fill from onboarding. Keep the seeded demo behind the
existing `seedDemo` flag (already there) so the judge path and the customer path do not
collide. The live board mutating under demo traffic (a recurring problem this week) is a
symptom of this not being separated.

Acceptance: `seedDemo=false` gives a clean empty start; the demo household still exists
for filming behind its flag.

### 3. The "aha" in the first five minutes — day-one value

A customer keeps what helps immediately. The moment that earns the keep: they enter their
mum's meds and one appointment, and CareCircle *immediately* shows the first thing nobody
owns and **offers to sort it** (the agent, asking — not assigning). That is the product's
whole thesis delivered as a first experience, not explained.

Acceptance: the setup flow's final screen/utterance is a real gap + the agent's offer,
generated from the customer's own data.

### 4. The selling artifact — store listing (Amazon requires it, and it forces the right thinking)

Write `docs/STORE-LISTING.md`: tagline, one-paragraph description, who it is for, 6–8
sample utterances, the privacy promise (below), and 3–4 screenshots. This is not
marketing fluff — Amazon's certification mandates it, and writing it is the fastest way
to discover where the product is still thinking like an engine.

### 5. Trust & privacy, stated for a paying customer

It is a family's **health-adjacent data**. A customer will not adopt without knowing what
is stored, what is not, and who can see it. We already have unusually strong material —
the whole system is built on "never assert what was not recorded" and "say who says so."
Turn that into a plain-language privacy promise on the store listing and the first-run
screen. This both sells and de-risks.

---

## Suggested Monday sequence

1. **Un-seed** (small, unblocks everything): `seedDemo=false` clean start, verify demo
   still available behind the flag. (§2)
2. **Onboarding flow** (the big one): conversational setup + `sim-ui` screen fallback,
   ending on the customer's own first gap + agent offer. (§1, §3)
3. **Store listing** doc: tagline → description → utterances → privacy → screenshots. (§4, §5)
4. Record the demo against the *customer* story (a real family setting up), not the
   seeded Margaret walkthrough — this doubles as onboarding proof.
5. Only then: back to friction log and `outputSchema` (still owed from the MCP design-guide
   audit — 23 tools, 0 `outputSchema`; see that thread in HANDOFF).

## What NOT to do Monday

- Do not add engine depth. It is done. Nobody keeps a product because it has 300 tests.
- Do not invent a disability taxonomy or new obligation attributes (decided earlier —
  deepen, don't widen).
- Do not build a second persona for the video. One arc.
- Do not let the demo household and the customer start share state.

## State at handoff (2026-09-18)

- 290 tests green, typecheck clean, working tree clean, all pushed to `origin/main`.
- Live: MCP `https://ypq2dfq2p7.us-east-1.awsapprunner.com`, sim
  `https://krqi2tpsif.us-east-1.awsapprunner.com`. 23 tools. Agent heartbeat on
  (`CARECIRCLE_AGENT_INTERVAL_MS=900000`).
- Deploy: commit first, `set -a; . ./.env; set +a`, `AWS_PROFILE=conductor
  ./infra/deploy-mcp.sh`, then `start-deployment` on BOTH services (the `:latest` image
  needs the explicit pull — the env-change deploy alone serves old code).
