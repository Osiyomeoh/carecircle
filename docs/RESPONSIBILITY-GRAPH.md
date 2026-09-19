# The Responsibility Graph

This is the core intellectual asset of CareCircle. Everything else — the MCP tools, the
Alexa+ conversation, Ring/Bee evidence, the Fire TV board, the trust benchmark — is an
*interface to* or a *proof of* this one model.

> We did not build a better task list. We built a graph that makes responsibility
> visible and makes it **structurally impossible for the system to invent guilt.**

This document is written to be honest about what is **built** (with a line reference into
the code) and what is a **delta** still to build. Nothing here is aspirational unless it
says `DELTA`.

---

## 1. The problem it solves — the missing middle layer

Most care systems track **facts** or **tasks**:

- Facts: *"Medications are X, Y, Z."*
- Tasks: *"David should pick up the prescription."*

They fail at the layer in between, which is where real families actually fail:

> Something **happened** → something is now **owed** → **nobody owns it** → it **drops**.

The responsibility graph exists to make that middle layer explicit, queryable, and safe.

---

## 2. The five nodes

```
ENTITY        who or what exists in the care world
                (Margaret, David, Renee, Pharmacy, Cardiology, a Ring device)
      │
EVENT         something that occurred, with provenance
                ("package arrived", "Margaret said she feels dizzy", "appointment created")
      │
OBLIGATION    something now owed because of one or more events
                explicit ("David will drive") or implied ("someone must get her there")
      │
OWNERSHIP     the binding of an obligation to an entity
                unowned │ proposed │ requested │ claimed/assigned │ rejected
      │
STATE         the obligation's status over its life
                proposed → open → assigned → resolved │ dismissed
```

### How the five map to the code today

| Node | In code | Status |
|------|---------|--------|
| Entity | `Member` + `Household` ([types.ts:16](../src/domain/types.ts)) — **people and the household only** | BUILT (people); `DELTA` for places/services/devices |
| Event | `CareEvent`, append-only, `reportedBy` + `occurredAt`/`recordedAt` ([types.ts:71](../src/domain/types.ts)) | BUILT; `DELTA` for explicit `source`/`confidence`/`derivedFrom` |
| Obligation | `Obligation` with required `provenance` ([types.ts:114](../src/domain/types.ts)) | BUILT |
| Ownership | `ownerId` + an append-only `transitions` log ([store.ts:217](../src/store/store.ts)) | BUILT |
| State | `ObligationStatus` state machine ([types.ts:86](../src/domain/types.ts)) | BUILT |

The design rule that makes the whole thing safe:

> **Every write that creates or changes an Obligation carries provenance. No provenance,
> no write.** In code this is not a convention — `Obligation.provenance` is a required,
> non-optional field, so an obligation that does not say how it is known cannot be
> constructed. That is how *Known ≠ Assumed* becomes structural instead of aspirational.

---

## 3. The allowed transitions — the real product

```
Event(s) arrive
      ↓
System may PROPOSE an obligation        status: PROPOSED   (confidence: INFERRED)
      ↓
A human (or the agent, only to ASK) may:
   • confirm it exists            PROPOSED → OPEN
   • claim it                     OPEN → ASSIGNED (owner = self)
   • be asked to take it          OPEN → REQUESTED (still unowned — a question, not a transfer)
   • answer a request             REQUESTED → ASSIGNED (yes) │ OPEN + declinedBy (no)
   • reject the proposal          PROPOSED → DISMISSED
      ↓
Owner works it
      ↓
Resolution closes it             → RESOLVED (with a resolution note + logged transition)
```

The state machine lives in `ObligationStatus` ([types.ts:86](../src/domain/types.ts)) and every
move is recorded in the `transitions` log. Its non-obvious, load-bearing choices:

- **The system may PROPOSE. It may never silently create confirmed ownership or guilt.**
  Inference always lands as `PROPOSED` + `INFERRED`, never `OPEN` + `CONFIRMED`.
- **`REQUESTED` is a distinct state from `ASSIGNED`.** Being *asked* is not having *agreed*.
  A `REQUESTED` obligation still has a null owner and still reads as a Care Gap. Collapsing
  the two would be exactly the assumption this system exists to refuse.
- **Rejection is first-class and logged.** A decline is information: `DISMISSED` for a
  wrong inference, or `declinedBy[]` for "I can't take this" — the agent then asks the next
  person, never the same one twice.
- **Silence is `unowned`, never "Margaret failed" or "David forgot."** There is no code
  path that turns the absence of a record into an accusation. This is asserted by the
  trust suite, not just intended.

---

## 4. Provenance as a first-class citizen

Every obligation says how it is known, via a discriminated union
([types.ts:43](../src/domain/types.ts)):

| Provenance | Meaning | Confidence weight |
|-----------|---------|-------------------|
| `CONFIRMED` | a named human asserted it — the only thing treated as fact | 1.0 |
| `NOT_LOGGED` | we expected a record and do not have one — **not** "it didn't happen" | 0.75 |
| `INFERRED` | the system guessed it, by a named rule, `from` a named source | 0.6 |

The confidence weight is not decoration — it multiplies into gap severity (§5), so **an
assumption can never outrank a fact.**

### `DELTA` — provenance on the *event*, not only the obligation

The spec's richer event provenance (`source`, `confidence`, `timestamp`, `actor`,
`derivedFrom[]`) is only partly in `CareEvent` today: we have `reportedBy` (actor) and
timestamps, and `source` is implicit in `kind: 'external_signal'` + `data`. To make the
"how do we know?" chain fully walkable we will add to `CareEvent`:

```ts
source: 'voice' | 'ring' | 'bee' | 'calendar' | 'system' | 'pharmacy';
confidence: 'observed' | 'reported' | 'inferred' | 'confirmed';
derivedFrom?: string[];   // ids of the events this one was inferred from
```

Worked example — the graph never collapses these three rows into one "fact":

```jsonc
// 1. sensor observed something
{ "kind": "external_signal", "source": "ring",  "confidence": "observed" }
// 2. system inference, explicitly marked and linked back
{ "kind": "check_in", "source": "system", "confidence": "inferred",
  "derivedFrom": ["<the ring event id>"], "status": "proposed" }
// 3. a human confirmed it
{ "kind": "obligation_resolved", "source": "David", "confidence": "confirmed" }
```

A family — or a judge — can always ask *"how do we know?"* and get the chain, not a verdict.

---

## 5. The Care Gap engine — deterministic reasoning

The engine does not "think" in the LLM sense. It walks the graph with rules
([gaps.ts](../src/domain/gaps.ts)):

1. Find `OPEN`/`REQUESTED` obligations (unowned, or asked-but-unanswered).
2. Keep those unowned or at risk of dropping.
3. Score `risk = Cost × P(dropped) × Confidence`, every term in `[0,1]`.
4. Rank, surface the top gaps.
5. Attach the factors so a human sees **why** it ranks where it does.

- **Cost** — normalized harm: medical 1.0, logistical 0.5, social 0.2.
- **P(dropped)** — a continuous hazard on the deadline (`exp(-hoursUntil/48h)`, →1 once
  overdue), OR-combined with an aging hazard for unowned work. No bucket staircase, so
  ranking is monotone.
- **Confidence** — the provenance weight from §4, multiplied in.

`HIGH/MEDIUM/LOW` are risk tertiles of the score, not magic cutoffs. When a judge asks
"why 85?", the answer is a derivation. The laws are *proven*, not just exemplified:
`gaps.props.test.ts` uses fast-check to assert boundedness, determinism, confidence
dominance (Known ≥ Assumed), imminence monotonicity, and cost ordering over thousands of
generated states.

**The division of labour that makes this both fluent and safe:**

- LLM / Alexa+ → natural language in and out, tool selection, *proposing* soft inferences.
- Deterministic graph + rules → ranking, invariants, and the refusal to invent ownership.

The LLM is a **speaker and a proposer.** The graph is the **source of truth and the conscience.**

---

## 6. Why this is not a task list or a care record

| Typical care app | Responsibility graph |
|------------------|----------------------|
| Task: "Pick up meds" | Obligation that *exists because of* prior events |
| Assignee field (often empty) | Ownership is an explicit, logged relation |
| "Missed dose" language | Unowned or unresolved — never accusatory by default |
| Data lives in one app | One graph ingests events from voice, Ring, Bee, calendar, pharmacy |
| The UI is the product | The **graph** is the product; voice / TV / cards are views |

---

## 7. One graph, many surfaces

```
                    ┌──────────────────────────┐
                    │  Responsibility Graph     │
                    │  (source of truth +       │
                    │   provenance)             │
                    └───────────┬──────────────┘
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
     ┌────▼────┐          ┌─────▼─────┐          ┌────▼────┐
     │ Alexa+  │          │ Ring / Bee│          │ Fire TV │
     │ (MCP)   │          │ (evidence)│          │(ambient)│
     │ talk &  │          │  write    │          │  read   │
     │ claim   │          │  Events   │          │  gaps   │
     └─────────┘          └───────────┘          └─────────┘
```

One write model, many read/write surfaces. No double entry, no second source of truth.
Only Alexa+ is a live MCP host; Ring/Bee enter through the `ingest_signal` seam and Fire
TV renders the same board the voice surface reads. What is LIVE vs. SEAM is stated plainly
in the README and `HANDOFF.md`, never blurred.

---

## 8. Minimal viable ontology (the tight schema)

This is a product, not a knowledge-graph research project. The schema is deliberately small.

**Entity** — `id`, `type` (`person | place | service | device`), `name`, `attributes?`
(e.g. `needsAccessibleTransport`). *Today: person + household only; `DELTA` for the rest.*

**Event** — `id`, `kind`, `householdId`, `reportedBy` (actor), `occurredAt`, `recordedAt`,
`detail?`, `data`. *`DELTA`: `source`, `confidence`, `derivedFrom[]`.*

**Obligation** — `id`, `what`, `status`, `consequence`, **`provenance` (required)**,
`ownerId | null`, `dueAt?`, `sourceEventId?`, `request?`, `declinedBy?`. *BUILT.*

**Ownership** — expressed as `ownerId` + the append-only `transitions` log
(`from`, `to`, `byMemberId`, `at`, `note?`). *BUILT.*

**Derived views** — open unowned obligations (the Care Gaps); the provenance chain for any
obligation (`DELTA` as a tool — see §9); role-aware filters (what each role may see/claim/reject).

---

## 9. How it maps to the MCP tools

The tools are thin. The intelligence and the safety live in the graph.

| Concern | Tool(s) | Status |
|---------|---------|--------|
| Write an event with provenance | `log_care_event`, `record_appointment`, `add_note`, `ingest_signal` | BUILT |
| Ranked unowned / at-risk work | `get_care_gaps` | BUILT |
| Create ownership | `claim_obligation`, `assign_obligation` | BUILT |
| Ask, not assign | `request_owner`, `respond_to_request`, `get_my_requests` | BUILT |
| Proposal → open or rejected | `confirm_proposal` | BUILT |
| Close with a resolution | `resolve_obligation` | BUILT |
| Buy in place (proposal → confirm) | `reorder_prescription`, `confirm_purchase` | BUILT |
| The agent that only ever asks | `run_care_agent` | BUILT |
| **Explain how we know something** | `get_provenance` | BUILT |

---

## 10. The delta plan — turning the spec into code

Ordered by leverage-per-risk. None of this rebuilds the engine; it deepens the graph. All
290 tests stay green and the trust benchmark stays at 0% false accusations, gated per step.

1. **`get_provenance` tool + provenance-chain view.** ✅ **DONE.** Pure walk in
   [`provenance.ts`](../src/domain/provenance.ts), exposed as the `get_provenance` tool.
   The data already existed (transitions log + `sourceEventId` + obligation provenance);
   this walks and speaks the chain — the literal answer to "how do we know?" — with no
   schema change. Its honesty is proven by an adversarial + property suite
   ([`provenance.test.ts`](../src/domain/provenance.test.ts)): a guess is always spoken as
   a guess, an absent record is never turned into "she didn't do it", and ownership is read
   from the obligation, never inferred from who recorded a move.
2. **Event-level provenance (`source` / `confidence` / `derivedFrom`).** Additive fields on
   `CareEvent` with safe defaults so existing writes keep passing; `ingest_signal` starts
   setting `source`/`confidence`, inferences set `derivedFrom`. Makes the chain in step 1 rich.
3. **First-class `Entity` for non-people + accessibility attributes.** Introduce
   `type: person | place | service | device` and `attributes` (`needsAccessibleTransport`,
   `requiresAssistance`). This is the biggest change (it is the one true widening) and it
   unlocks the single disability beat — one obligation type, same tools, care recipient can
   still reject by voice. Add one disability case to the trust benchmark.

Everything past this — richer scoring, more entity types, nicer cards — is amplification.

---

## 11. The sentence that should survive in the judges' heads

> We did not build a better task list. We built a graph that makes responsibility visible
> and makes it structurally impossible for the system to invent guilt.

The demo beat, the trust benchmark, the multi-surface coherence, and the friction log all
exist to make this model real, measurable, and impossible to ignore.
</content>
