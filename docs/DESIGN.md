# CareCircle - Design

**The responsibility layer for families caring for someone.**

Most assistants answer *"what is Mom's status?"*. CareCircle answers a harder question:
**"What needs to happen for Mom, and who is responsible for it?"**

---

## 1. The thesis

```
EVENTS  ->  OBLIGATIONS  ->  OWNERSHIP
```

| Stage | Question | Example |
|---|---|---|
| Event | What happened? | "I took my heart pill" / "Cardiology is Thursday at 10" |
| Obligation | What needs to happen? | Someone must drive Margaret to cardiology |
| Ownership | Who has it? | David claimed it - or **nobody has** |

A **Care Gap** is the failure state of stage three:

> Something important is known to need attention, and nobody owns it yet.

That is the phrase the project is built to own.

---

## 2. Non-negotiable rule: absence of a record is never proof

Every fact in the system carries **provenance**. The system distinguishes four
epistemic states and never collapses them:

| State | Meaning | Spoken as |
|---|---|---|
| `CONFIRMED` | A human asserted it | "Margaret logged her evening dose at 7:42pm" |
| `NOT_LOGGED` | No record exists | "I have no record of the evening dose" |
| `INFERRED` | The system guessed it | "Cardiology usually needs a ride - is that right?" |
| `RESOLVED` | An obligation was discharged | "David drove her Thursday" |

The system will **never** say "Margaret did not take her medication." It only ever
reports what it knows and what it is missing. This is a hard constraint in the
response layer, not a stylistic preference.

### Why this matters technically

Section 3 depends on *inference* ("an appointment probably needs transport").
Section 2 forbids dressing inference as fact. These reconcile in one mechanism:

**Inferred obligations enter as `PROPOSED`, never as `OPEN`.**
A human confirms a proposal before it becomes real work someone can be
accountable for. Inference proposes; humans dispose.

---

## 3. The Care Gap Engine

Deterministic logic **in the server** - not model narration. The model's only job
is to speak the result. Given care state, the engine computes ranked gaps:

```
Appointment: Cardiology, Thursday 10:00
  |
  +-- rule: appointments of type {medical} imply a TRANSPORT obligation
  |
  v
Obligation: "Drive Margaret to cardiology"
  provenance: INFERRED (rule: medical-appointment-transport)
  status: PROPOSED -> (human confirms) -> OPEN
  owner: NONE
  |
  v
CARE GAP  [severity: HIGH - dated, imminent, unowned]
```

Gap severity is computed from: imminence, whether the obligation is dated,
consequence class (medical > logistical > social), and how long it has sat unowned.

Gap taxonomy:

| Marker | Kind | Example |
|---|---|---|
| UNCLAIMED | Obligation exists, no owner | Drive Mom to cardiology |
| UNCONFIRMED | Expected event with no record | Evening medication not logged |
| NEEDS_FOLLOW_UP | Resolution is stale or partial | Prescription refill requested, not picked up |
| RESOLVED | Discharged | Grocery pickup, done by Renee |

**The killer query** - *"What's going to fall through the cracks this week?"* - is a
single call into this engine returning structured, ranked, reasoned gaps.

---

## 4. One record, several relationships

The same MCP server serves every member of the circle with different authority
and a different conversational stance.

| Member | Role | Says | Can |
|---|---|---|---|
| Margaret, 78 | `care_recipient` | "I took my heart pill" | Log her own events; hear her own day |
| David | `primary_caregiver` | "What hasn't been assigned?" | Everything: claim, assign, confirm, escalate |
| Renee | `caregiver` | "What does Mom need this week?" | Claim and add; cannot escalate |
| Aide | `helper` | "What do I need to know today?" | Scoped to the current shift |

Identity is established by the MCP session (per-member credential), not guessed
from the conversation. **The household - not the individual - is the unit of state.**
That is the hard technical problem of this project and the part most entrants
will not have.

---

## 5. MCP surface

```
                      Alexa+ / agent
                            |
                        MCP (Streamable HTTP, 2025-11-25)
                            v
                  +---------------------+
                  |  CareCircle server  |
                  +----------+----------+
                             |
        +------------+-------+-------+------------+
        v            v               v            v
    Resources      Tools          Prompts     Elicitation
    care state     log event      daily check  confirm a
    timeline       claim gap      weekly       proposed
    family         add note       review       obligation
        |            |
        +------------+
                  v
          Care State Engine  (gap detection, provenance, severity)
                  v
          Event-sourced store
```

Design rules for the tool layer:

- Tools exist because **a person says a sentence that needs them** - not to mirror CRUD.
- Errors instruct the model on what to do next; they are not stack traces.
- Ambiguity is resolved by asking ("which Thursday appointment?"), never by guessing.
- Responses are shaped to be **spoken aloud** without reformatting.
- Write actions that carry consequence require confirmation via elicitation.

---

## 6. What this is, beyond the hackathon

An open-source MCP server for **shared household coordination**. Caregiving is the
first and most urgent instance, but the Events -> Obligations -> Ownership model
underlies disability support, family logistics, community care, and any setting
where several people share responsibility for someone who is not fully able to
advocate for themselves.

---

## 7. Deferred: ambient obligation capture (Bee)

**Status: gated. Do not start until the MCP server, the simulator, and the video
script are done.**

The current input model has one real weakness: an obligation only enters the system
when somebody explicitly states it. In actual caregiving, obligations are created in
conversation - at the clinic, on the phone with the pharmacy, in the kitchen. Nobody
stops to log them. That is *why* things fall through the cracks.

Bee (an ambient conversation recorder, usable via app + CLI with no hardware) closes
that loop:

```
Real conversation at the cardiology appointment
        |
        v
Bee transcript / facts  (CLI or MCP)
        |
        v
Obligation extraction
   provenance: INFERRED
   status:     PROPOSED       <- never asserted as fact
        |
        v
Human confirms  ->  OPEN  ->  claimable
```

This needs no new trust machinery: section 2 already requires that inferences enter
as proposals for a human to confirm. Ambient capture is simply another source of
`INFERRED` obligations.

**Why it is gated anyway:** the Alexa+ track is judged on MCP quality, and Bee
improves none of that. A project may win only one track prize and one mini challenge,
so this adds strength to the idea, not another prize. And a half-working ambient
capture is worse on video than none at all.

**If time allows**, this is the highest-value remaining work, because it makes the
strongest possible demo claim: *nobody typed any of this in.*
