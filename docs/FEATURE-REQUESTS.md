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
  whole premise is one shared record and four relationships to it — a care recipient,
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
- **What:** Documented conventions for shaping tool output that will be *spoken* —
  length limits, how lists are read aloud, whether the model reformats or reads
  verbatim, how to mark something as a question back to the user.
- **Why it matters:** A voice surface has hard constraints a chat surface does not.
  Four unclaimed care gaps read aloud is fine; fourteen is unusable. We are guessing
  at the ceiling. Every add-on developer will guess differently, and customers will
  experience the inconsistency.

### Confirmation before consequential actions
- **Urgency:** important
- **What:** A documented contract for how Alexa+ surfaces MCP elicitation, and whether
  a server can require confirmation before a write.
- **Why it matters:** CareCircle assigns responsibility for someone's medical care. If
  a model mishears and assigns Thursday's hospital run to the wrong person, that is a
  real-world failure, not a bad chat response. Servers with consequences need a
  guaranteed confirmation path, not a convention.

---

## AWS (Bedrock AgentCore / Strands)

_To be filled in as we build the hosting and agent layers._
