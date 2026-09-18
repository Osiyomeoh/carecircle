# Feature requests

These are the things we kept wishing existed while building - written down in the moment,
addressed to the teams who own each surface, and rated by how much they actually hurt:
critical / important / nice-to-have. None of them are wishlist padding; every one is a
place where we wanted to do the right thing for a family coordinating someone's care and
the platform made us choose a workaround instead. Where we found a way around it, we say
so - the workaround is usually the tell for what the platform should have handled.

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

### A way for a server to state the current date and time
- **Urgency:** critical
- **What:** Let a server advertise the current timestamp and an IANA timezone to the
  client - the natural counterpart to `instructions` on initialize, or a standard
  `_meta` key.
- **Why it matters:** This is the only request here that has already produced wrong
  data in a medical record. Asked to record "cardiology Thursday at ten", a planner
  that does not know today's date emitted **19 December 2024** for an appointment
  spoken in September 2026, with no timezone, and it was written to the live care
  record and rendered to the family as real. A tool description can say "resolve
  against today's date"; it cannot say *what today's date is*. Every MCP server that
  deals in relative dates - scheduling, reminders, deadlines, anything with
  "tomorrow" in it - has this problem right now, and each is solving it by stuffing
  the date into a prompt the server may not control.
- **Instead:** We stamp the date and household timezone into the planner prompt we
  own, normalise offset-less timestamps as household-local, and refuse any date more
  than two days past or a year ahead.

### An explicitly non-authoritative speaker hint
- **Urgency:** important
- **What:** An optional field by which a host may pass "I believe this turn is from
  profile X", clearly specified as evidence rather than proof.
- **Why it matters:** Shared devices are the normal case for family products. On a
  living-room Echo the credential identifies the *household* while the speaker changes
  every turn. Identity must stay bound to the credential for authorisation - a model
  can be talked into believing anything about who is speaking - but a weak signal a
  server may treat as `INFERRED` would let a shared device stop asking "who is this?"
  every turn. Our whole trust model is built on ranking evidence by confidence; we
  would consume this correctly and so would anyone else who needed it.
- **Instead:** One session per member, chosen explicitly.

### A way to mark tool result content as user-supplied
- **Urgency:** important
- **What:** A `_meta` flag or content-part annotation meaning "this text was typed by
  a person, not authored by the server".
- **Why it matters:** Hosts reasonably treat output from a trusted server as
  trustworthy, but servers increasingly return *other people's words*. A care note
  written by a paid aide travels the same path as text the server wrote itself. As
  more MCP servers relay user-generated content, "all tool output is equally
  trustworthy" stops being a safe default - and a server currently has no vocabulary
  to say otherwise.
- **Instead:** We never interpolate free text into instructions, and every
  state-changing action requires a tool call the capability model authorises
  independently.

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
- **Update (2026-09-18):** the rendering contract we asked for now exists at the MCP
  layer - the MCP Apps extension (SEP-1865) - and we have shipped against it. Our
  `get_care_gaps` is an MCP App: it points at a `ui://` resource, and a host that
  supports the extension draws the ranked board, provenance and all, with the ranking's
  arithmetic inspectable and a Claim button that calls `claim_obligation` straight back
  through the host. So the *protocol* half of this request is answered, and we would
  rather say so than keep the complaint. What is still open is the half only Amazon can
  close: **Alexa+ adopting the extension**, so the same view a desktop host already
  draws today reaches an Echo Show, and degrades to our existing speech on a headless
  device. We built the card once, to the open standard; we are asking for it to be
  rendered where the family actually is.

> *This is the one that genuinely frustrated us, because we could feel the good product
> on the other side of the wall. We compute a ranked list with severity, owner, due time
> and a reason for every gap - and then, at the speech boundary, we flatten it to a
> sentence and throw the structure away. Building the care board in our own simulator was
> partly us refusing to accept that the richest thing we make has to die as audio.*

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
- **Update (2026-09-18):** also answered by MCP Apps, and better than we asked for. We
  wanted a card that could carry a bound tool call; the extension gives the view the
  actual client, so our Claim button makes a real `tools/call` down the same
  authorisation path as speech - no second, weaker permission model for taps. The one
  thing we had to add ourselves was telling the model afterwards
  (`ui/update-model-context`), or it keeps offering work the hands already took.

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

## AWS (Transcribe, Polly) and Ring

### Nigerian English (`en-NG`) for Amazon Transcribe
- **Urgency:** important
- **What:** An `en-NG` locale, on a par with `en-ZA`, `en-IN` or `en-AU`. Beyond that,
  Yoruba and Igbo, each spoken by tens of millions - `ha-NG` (Hausa) already exists,
  so the pipeline clearly supports Nigerian languages.
- **Why it matters:** Nigeria is the largest English-speaking country in Africa and
  among the largest anywhere, and there is no English variant for it. A Nigerian
  speaker is transcribed by a model tuned for another continent. The failure lands
  hardest on **names** - a care system that mis-hears "Adaeze" or "Oluwaseun"
  attributes a medication to the wrong person. This is a silent accuracy tax on an
  entire region, and it is invisible in aggregate benchmarks.
- **Instead:** A custom vocabulary built from each household's own care record, plus a
  phonetic repair pass that maps a mishearing back onto a person who actually exists
  in that household. The custom-vocabulary API did most of the rescuing here - the gap
  is coverage, not capability.

### "Send a test event" in the Ring Developer Portal
- **Urgency:** important
- **What:** A per-event-type test button in the staging tab that fires a correctly
  signed event at the registered webhook.
- **Why it matters:** Ring staging is documented as testing against *real devices*,
  while the hackathon explicitly permits a simulator and states no physical device is
  required. Those two positions are in tension, and the gap is a hardware purchase
  standing between a developer and a working integration. Signed test events are the
  ordinary expectation for a webhook API.
- **Instead:** We wrote a device simulator that builds events in Ring's documented
  shape and signs them with the real partner HMAC key, so verification, idempotency
  and inference all run exactly as they would for Ring traffic.

---

## AWS (Bedrock)

These came straight out of the friction log - the Bedrock quota saga cost us most of a
day, and the fixes are small.

### Show me my daily token budget before I spend it
- **Urgency:** important
- **What:** Surface daily token consumption and remaining budget in the Bedrock console
  and via an API readable with plain Bedrock access - the way Service Quotas already does
  for request rates.
- **Why it matters:** We ran a batch eval and every call died with
  `ThrottlingException: Too many tokens per day`. There was no figure, no reset time, no
  page to check - the only way to learn the limit was to hit it, and the only way to learn
  it had reset was to retry. For anything batch-shaped (evals, backfills) that makes the
  service unplannable.
- **Instead:** We excluded throttled cases from results and paced calls by hand.

### Tell me "zero quota" and "spent quota" apart
- **Urgency:** critical
- **What:** Distinguish an exhausted budget from an account whose quota is *zero*, in both
  the error class and the message. A permanent zero should not arrive as a retriable
  `ThrottlingException`.
- **Why it matters:** Our account's applied inference quota was 0 against a default of a
  million, but the error said "too many tokens per day" - so we spent hours looking for a
  workload that had drained a budget that never existed. Clients retry throttling by
  default, which for a zero quota means retrying forever. These are opposite situations and
  only one is worth waiting out.
- **Instead:** We built a preflight ([`docs/FRICTION-LOG.md`](FRICTION-LOG.md)) that reads
  the applied-vs-default quota and tells the developer which case they're in, so the app
  explains the failure instead of advising a wait that will never end.

_AgentCore / Strands hosting notes to follow as we build that layer out._
