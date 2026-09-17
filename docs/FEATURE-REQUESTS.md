# Feature requests

Written while building, addressed to the teams that own each surface. Urgency is
rated critical / important / nice-to-have.

Template: what we wanted, why it mattered *for this project*, what we did instead.

---

## MCP specification / TypeScript SDK

### Per-identity sessions as a first-class concept
- **Urgency:** important
- **What:** A documented pattern for a server whose state is shared across several
  *people* with different authority, where the session credential establishes which
  person is acting.
- **Why it matters:** MCP today reads as one user talking to one server. CareCircle's
  whole premise is one shared record and four relationships to it - a care recipient,
  two family caregivers with different authority, and a paid helper. Every tool call
  has to be attributed and authorised. We built this ourselves, but every multi-user
  MCP server will rebuild the same thing, differently, and most will get authorisation
  subtly wrong.
- **Instead:** Per-member bearer credentials mapped to a member id, checked against a
  role capability table on every call.

### A spec-version support matrix
- **Urgency:** nice-to-have
- **What:** Published mapping of SDK release -> supported spec versions.
- **Why it matters:** We had to target spec 2025-11-25 specifically. Determining which
  SDK release supports it required grepping compiled output. See friction log.

---

## Alexa+ / Amazon add-ons

### A local simulator for add-on conversations
- **Urgency:** critical
- **What:** An official local harness that runs an MCP server against the real Alexa+
  planner and speech surface, without needing an invite or a device.
- **Why it matters:** Add-ons are invite-only, and per Amazon's own office hours you
  cannot currently drive an Echo Show from an SDK. Everyone outside the preview is
  guessing at how Alexa+ will actually choose between their tools, how it will phrase
  results, and where it will get confused. We are building our own simulator, which
  means we are optimising against *our* model's behaviour, not Alexa's. If add-ons are
  meant to be an open ecosystem, this is the single biggest gap.

### Guidance on speakable tool responses
- **Urgency:** important
- **What:** Documented conventions for shaping tool output that will be *spoken* -
  length limits, how lists are read aloud, whether the model reformats or reads
  verbatim, how to mark something as a question back to the user.
- **Why it matters:** A voice surface has hard constraints a chat surface does not.
  Four unclaimed care gaps read aloud is fine; fourteen is unusable. We are guessing
  at the ceiling. Every add-on developer will guess differently, and customers will
  experience the inconsistency.

### Elicitation assumes a request that can stay open; a voice turn cannot
- **Urgency:** important
- **What:** Guidance (or a protocol affordance) for elicitation on surfaces where a
  single request cannot stay open across a human's response - voice being the clearest
  case.
- **Why it matters:** MCP elicitation expects the answer to arrive inside the same
  `tools/call` that raised it. An Alexa turn is over in seconds, so the two disagree
  about how long one request may stay open. A bridge author who put an Alexa Skill in
  front of MCP servers hit exactly this and had to park the open call and resume it on a
  later turn. CareCircle sidesteps it by modelling confirmation as a *separate* tool call
  (`confirm_proposal`): "will Mom need a ride?" then "yes" survives any gap between turns
  with nothing parked. That works, but it is a workaround for a protocol assumption that
  does not hold on voice. Worth either documenting the pattern or letting a server mark a
  tool's elicitation as resumable out-of-band.

### Confirmation before consequential actions
- **Urgency:** important
- **What:** A documented contract for how Alexa+ surfaces MCP elicitation, and whether
  a server can require confirmation before a write.
- **Why it matters:** CareCircle assigns responsibility for someone's medical care. If
  a model mishears and assigns Thursday's hospital run to the wrong person, that is a
  real-world failure, not a bad chat response. Servers with consequences need a
  guaranteed confirmation path, not a convention.

### Rich cards: a structured visual return channel for MCP results
- **Urgency:** critical
- **What:** A way for an MCP server to return a *renderable* result alongside spoken
  text - a card with fields, status, and actions - that Alexa+ displays on a screen
  device and degrades gracefully to speech on a headless one.
- **Why it matters:** This is the single biggest constraint we hit. CareCircle's core
  answer is a *ranked list with state*: four care gaps, each with a severity, an owner
  or the absence of one, a due time, and a reason. Spoken, the usable ceiling is about
  three items - past that a person cannot hold the list in their head. On a screen, a
  family absorbs twelve at a glance and points at the one they mean.
  Today the whole answer has to be flattened into a sentence, which throws away exactly
  the structure that makes it useful. We already compute `severity`, `because`,
  `dueAt` and `owner` per gap and have to discard all of it at the speech boundary.
- **Shape we would want:** `structuredContent` is already in the spec and already
  carries this data. What is missing is a *rendering contract* - an agreed schema (or a
  set of card types: list, detail, confirmation, status) that a host knows how to draw,
  so servers do not each invent their own and hosts do not have to guess.
- **Instead:** We truncate to three spoken items and say how many remain, and we render
  our own cards in our simulator to show what the experience should be.

### Actionable cards: let a card carry the next tool call
- **Urgency:** important
- **What:** Cards whose controls invoke a named tool with bound arguments - a Claim
  button on a care gap that calls `claim_obligation` with that id.
- **Why it matters:** "I'll take the cardiology one" requires the model to resolve a
  referring expression to an id, and it will sometimes get that wrong. When the action
  is assigning responsibility for a hospital trip, sometimes-wrong is not acceptable.
  A tap is unambiguous. Voice is the right input for *capture* and the wrong input for
  *disambiguation among similar items* - a good multi-modal design uses each for what
  it is good at.

### Confirmation as a first-class surface
- **Urgency:** important
- **What:** A host-rendered confirmation step for consequential tool calls, showing
  what is about to happen and who it affects, before it happens.
- **Why it matters:** Related to elicitation, but the point is the *display*: before
  Thursday's hospital run is assigned to Renee, Renee's name should be on screen. See
  also the confirmation request under Alexa+ above.

### Ambient and glanceable state, not just turn-taking
- **Urgency:** nice-to-have
- **What:** A way for an add-on to contribute to a device's ambient/home screen -
  the state a screen device shows when nobody is talking to it.
- **Why it matters:** The most valuable moment for CareCircle is not a conversation. It
  is a family member walking past the kitchen Echo and noticing that Thursday still has
  no driver. Care coordination is ambient by nature; the conversational turn is the
  exception, not the rule. Every assistant integration model we have seen assumes the
  conversation is the product.

---

## AWS (Bedrock AgentCore / Strands)

_To be filled in as we build the hosting and agent layers._
