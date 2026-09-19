# The 40-second beat — the one take that proves it is real

The 3:00 video ([VIDEO.md](VIDEO.md)) earns all four judging axes. This is the **single
continuous 40-second shot** inside it that does the one thing no other assistant does, and
does it **irreversibly, on the real running system, in one take**. If a judge watches only
40 seconds of CareCircle, it is this. If a judge suspects the whole thing is a mockup, this
is the beat that refutes them.

**Why "irreversible" is the whole point.** Everything demo-able can be faked with a slide
deck — except a system committing a change it cannot take back. This beat commits three:
an obligation is *asked* of someone, *declined*, and *accepted* — each written to an
append-only log, each visible on two independent surfaces at once, and none of it undoable.
The proof is not that it looks slick; it is that at 0:40 the recorded history exists and
can be replayed with `get_provenance`. You cannot stage that. That is the argument.

**One rule: one take, no cuts, no alt-tab.** The moment there is an edit, the beat stops
proving the thing it exists to prove. Two windows are arranged before recording rolls; the
camera never leaves them. If a line fumbles, the whole 40 seconds is reshot from the top.

---

## The state the shot opens on

Run `npm run demo:reset` first. The board opens with:

- The **cardiology appointment**, Thursday, and a **ride nobody owns** — its subject is
  Margaret, who needs accessible transport, so it ranks with the weight that carries.
- No zombie `PROPOSED` rows (dismiss the two dated 2024-12-19 if present — see VIDEO.md).

Two windows, arranged and never left:

- **Left — voice:** the simulated Alexa+ console (`npm run sim`), signed in as **David**.
- **Right — the shared board:** the Fire TV surface, a second live MCP session on the same
  household. It is not a screenshot of the left window; it is an independent reader of the
  same append-only store. That independence is what makes the simultaneous clear mean
  something.

---

## 0:00 – 0:40, second by second

Timings are targets; the spoken lines and the tool calls are exact. Every tool named here
is one of the 23 the server actually exposes — nothing is narrated that the system does not
do.

### 0:00 – 0:06 · The gap, and why it ranks

> **David (voice):** "What's going to fall through the cracks this week?"
> **CareCircle:** "The ride to cardiology Thursday has no driver yet. It's ranked highest —
> it needs accessible transport, so there are fewer fall-back rides if it slips."

- **Fires:** `get_care_gaps`
- **Right (board):** the ride sits at the top, its score expanded to `cost × p(dropped) ×
  confidence`. **Caption:** `severity is arithmetic — an assumption can never outrank a fact`
- The accessibility clause is spoken **as a logistics fact, never a verdict about her.**
  That refusal is the same one the medication beat makes, one level over.

### 0:06 – 0:16 · Ask, not assign

> **David:** "Ask Renee to take her."
> **CareCircle:** "I've asked Renee. Asked isn't agreed, so this is still an open gap."

- **Fires:** `request_owner` (Renee)
- **Both surfaces, simultaneously:** the ride flips to a `REQUESTED` chip.
  **Caption:** `REQUESTED — asked is not agreed. Still a Care Gap.`
- **This is the first irreversible write.** The request is now in the log with who asked,
  who was asked, and when.

### 0:16 – 0:26 · A "no" is information, not a failure

> **Renee (voice, second device):** "I can't, I'm working Thursday."
> **CareCircle:** "That's noted — the ride is back with no owner."
> **David:** "Then ask Tasha, the aide."
> **CareCircle:** "I've asked Tasha. It stays unowned until she says yes."

- **Fires:** `respond_to_request` (decline) → `request_owner` (Tasha)
- **Both surfaces:** Renee's name clears; Tasha's appears as the new `REQUESTED`.
  **Caption:** `a decline is recorded, never counted as fault`
- The decline is written to the log. It is **not** erased when the ask moves on — that
  permanence is the point.
- **Note on who advances the ask.** In this beat David redirects explicitly, so the take is
  deterministic on camera. The system's own answer to "ask the *next best* person" is the
  `run_care_agent` tool, which picks by load and asks **family before paid help** — after
  Renee's decline it actually offers David next. That autonomous path is the centrepiece of
  the full `npm run story`; here we keep David in the driver's seat so the shot never
  branches on the agent's choice.

### 0:26 – 0:34 · The gap clears on both screens at once

> **Tasha (voice):** "Yes, I've got Thursday."
> **CareCircle:** "Thank you. Tasha owns the ride to cardiology Thursday."

- **Fires:** `respond_to_request` (accept) → obligation transitions to `ASSIGNED`, `ownerId`
  set to Tasha
- **The hero frame:** the HIGH card clears on the **left and right windows in the same
  instant**, because both are reading the same committed state. No cut. **Hold it for two
  seconds.**

### 0:34 – 0:40 · The proof you cannot fake

> **David:** "How do we know Tasha's got it?"
> **CareCircle:** "Renee was asked Thursday and said she was working, so it went to Tasha,
> who accepted. Right now Tasha owns it."

- **Fires:** `get_provenance` (the ride)
- **On screen, held to the cut:** the chain — *asked → declined → re-asked → accepted →
  owned* — every step timestamped, replayed from the append-only log, **not narrated by a
  model.** **Caption:** `every step recorded. nothing invented. reproducible: npm run story`

---

## Why this survives a skeptical judge

- **It is one take.** No edit hides a reset or a retake. The state genuinely moves from
  "nobody owns the ride" to "Tasha owns it" and cannot move back within the shot.
- **Two independent surfaces clear together.** A mockup animates one screen; it cannot make
  a second, separately-connected reader agree in the same frame unless the change is real.
- **The history is replayable.** `get_provenance` at 0:34 reads the actual transition log.
  If any of it were staged, the chain would not exist to show.
- **Every claim is reproducible with no cloud, no keys:** `npm run beat` replays this exact
  sequence headless against the real in-process server (ask → decline → re-ask → accept, then
  the provenance chain); `npm run story` walks the full seven-beat scenario;
  `npm run trust-benchmark` reproduces the refusal numbers. Told, then provable.

## The numbers this beat is allowed to say (keep honest)

- **23 tools**, live, MCP spec 2025-11-25 — every tool in the beat is one of them.
- **311 tests**, including the adversarial + property suites behind the refusal and the
  accessibility ranking.
- Do **not** say the eval % or imply Ring/Bee did anything here — this beat is voice + board
  only, so there is nothing to overclaim.

## Two staging choices to make before you roll

Both are visible in `npm run beat` today, and both are decisions, not bugs — set them the
way the shot needs:

1. **Severity tier vs. rank.** The ride is always the **top-ranked** gap (accessibility
   uplift lifts it above the pickup — you can hear the reason in its `because`). But the
   HIGH/MEDIUM/LOW *tier* is expected harm, and expected harm rises as the deadline nears:
   a cardiology ride five days out reads LOW even at rank one. If you want the card to read
   **HIGH** on camera, seed the appointment nearer (within ~2 days). Say "ranked highest"
   (true regardless) rather than naming a tier the board might not show.

2. **What the origin line says.** The seeded ride carries `INFERRED` provenance and is never
   run through `confirm_proposal`, so at 0:34 the chain opens with *"still a suggestion, not
   a fact"* even though Tasha now owns it — honest about the origin, but easy to misread
   aloud. If you want the origin to read as human-confirmed, confirm the proposal in the
   opening state first; the ownership steps that carry the beat are unaffected either way.

## If the take breaks

Reshoot from 0:00 — do not splice. A single continuous failure-free take is the deliverable;
a spliced one forfeits the only thing the beat was for. Recovery order between takes:
`npm run demo:reset`, re-confirm the board is in the opening state, then roll.
