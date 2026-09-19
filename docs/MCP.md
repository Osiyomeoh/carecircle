# Connecting to the CareCircle MCP server

Everything a client needs: how to connect, what the server exposes, who is allowed
to call what, and how to run your own.

CareCircle is a **self-hosted MCP server** implementing spec **2025-11-25** over
**Streamable HTTP**, built on `@modelcontextprotocol/sdk` 1.30.0. It exposes 18
tools, 2 resources, 2 prompts, and one interactive view via the
[MCP Apps extension](#the-care-board-mcp-apps).

One idea governs the whole surface, and a client that ignores it will produce
wrong answers that sound right:

> **The server only knows what has been recorded. An absent record is not
> evidence that something did not happen.** Speak tool results as written, and
> never restate a missing record as someone having failed to do something.

The server sends this to every client in its `instructions` on initialize. It is
not decoration - it is the difference between "there's no record of the evening
dose" and an accusation aimed at whoever was supposed to be there.

---

## Endpoint

| | |
|---|---|
| **URL** | `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp` |
| **Health** | `https://ypq2dfq2p7.us-east-1.awsapprunner.com/health` |
| **Transport** | Streamable HTTP (POST; responses may be JSON or SSE) |
| **Protocol** | `2025-11-25` |
| **Auth** | `Authorization: Bearer <token>` - required on every request |

The public server runs the demo household (Margaret's care circle) so a client can
be pointed at it and immediately have something real to talk about. It is a demo:
do not put anybody's actual medical information in it.

### Demo credentials

Each token *is* an identity. Which person you authenticate as changes what you are
allowed to do, so pick the one whose authority you want to exercise.

| Token | Member | Role |
|---|---|---|
| `renee-token` | Renee | `primary_caregiver` - full authority |
| `david-token` | David | `caregiver` |
| `margaret-token` | Margaret | `care_recipient` - the person being cared for |
| `aide-token` | Tasha | `helper` - paid aide, scoped to her shift |

---

## Client configuration

### Claude Desktop

Remote servers go through the `mcp-remote` shim. In
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "carecircle": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp",
        "--header", "Authorization:Bearer renee-token"
      ]
    }
  }
}
```

Restart Claude Desktop, then ask *"What care gaps still need an owner?"*

### MCPJam Inspector

`npx @mcpjam/inspector`, then **Connect → Add Server**: Connection type `HTTP`,
URL as above, Authentication `Bearer Token`, token `renee-token`. MCPJam renders
the Care Board, so this is the quickest way to see the MCP App working.

### Anything else

Any client speaking Streamable HTTP with a bearer header works. The handshake is
ordinary MCP:

```bash
# 1. initialize - the response header carries the session id
curl -sD - -X POST "$URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer renee-token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},
        "clientInfo":{"name":"my-client","version":"1.0"}}}'

# 2. notifications/initialized, then any call, both with mcp-session-id
curl -s -X POST "$URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer renee-token' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"get_care_gaps","arguments":{}}}'
```

Responses may arrive as SSE (`event: message\ndata: {...}`) rather than plain
JSON, depending on the request. Handle both.

---

## Identity is bound to the session, never to the conversation

This is the part most worth understanding, because it is where a multi-user MCP
server usually goes wrong.

**Who you are is established by the credential, not by anything anyone says.**
There is no `actingAs` parameter on any tool, and no way to tell the server you
are someone else. A model that is talked into believing it is the primary
caregiver still cannot act as one.

- A request with **no credential** → `401` with a `WWW-Authenticate: Bearer` header.
- An **unknown credential** → `401`.
- A **different member's credential inside an existing session** → `403`. Sessions
  cannot be handed between people mid-stream.

These are covered by an adversarial test suite (`src/adversarial.test.ts`), because
in a system that assigns responsibility for someone's medical care, the identity
rules are the product rather than a convenience.

### Roles and capabilities

| Capability | care_recipient | caregiver | primary_caregiver | helper |
|---|:--:|:--:|:--:|:--:|
| `log_own_event` | ● | ● | ● | |
| `log_others_event` | | ● | ● | ● |
| `read_full_state` | | ● | ● | |
| `read_shift` | ● | ● | ● | ● |
| `create_obligation` | ● | ● | ● | |
| `claim_obligation` | | ● | ● | ● |
| `assign_obligation` | | | ● | |
| `confirm_proposal` | | ● | ● | |
| `resolve_obligation` | | ● | ● | ● |
| `escalate` | | | ● | |
| `manage_circle` | | | ● | |
| `make_purchase` | | ● | ● | |

**Denials are written for a model to speak, not for a developer to debug.** They
say what the caller *can* do instead, so a refusal moves the conversation forward:

> *"Only the primary caregiver can assign work to someone else. You can take it on
> yourself instead."*

Treat every `isError` result the same way - the text is an instruction about what
to do next, and should be acted on rather than reported as a failure.

---

## Tools

22 tools. Every one exists because a person says a sentence that needs it; there is
no tool here that mirrors a database table for its own sake.

`?` marks an optional argument.

### Recording what happened

| Tool | Arguments | Notes |
|---|---|---|
| `log_care_event` | `kind`, `medicationName?`, `detail?`, `occurredAt?`, `aboutMemberId?` | `kind` is `medication_taken` \| `check_in`. Logging about someone else needs `log_others_event`. |
| `record_appointment` | `kind`, `startsAt`, `forMemberId?`, `detail?` | May generate `PROPOSED` work (a ride, someone to take notes) that a human must confirm. |
| `add_note` | `note`, `aboutMemberId?`, `unavailable?` | `unavailable` (`memberName`, `from`, `to`) records that someone *cannot* cover a window - work they were quietly covering may stop being covered. |
| `ingest_signal` | `source`, `kind`, `occurredAt?`, `detail?` | The device seam. Any external observation (Ring, a wearable) enters here and becomes an `INFERRED` proposal, never a fact. |

### Finding and moving responsibility

| Tool | Arguments | Notes |
|---|---|---|
| **`get_care_gaps`** | `withinDays?` | **The core tool.** Everything needing attention with no owner, ranked. Read-only, idempotent. Renders the [Care Board](#the-care-board-mcp-apps). Also the way to resolve "that one" / "yes" / "I've got it" to a specific id. |
| `claim_obligation` | `obligationId` | The speaker takes it on themselves. |
| `assign_obligation` | `obligationId`, `assigneeName` | Gives it to someone else. Primary caregiver only. |
| `confirm_proposal` | `obligationId`, `confirmed` | Turns a system guess into real work, or dismisses it. |
| `resolve_obligation` | `obligationId`, `note?` | Marks it done. |

### Delegation - asking, not assigning

The circle's defining move: work is *offered* down the circle and only becomes owned
when someone says yes. Being asked is a distinct state (`REQUESTED`) from having agreed
(`ASSIGNED`); a decline is recorded, not erased, and the agent asks the next person
rather than the same one twice.

| Tool | Arguments | Notes |
|---|---|---|
| `request_owner` | `obligationId`, `assigneeName?` | **Asks** someone to take work on; it does not assign. The work stays unowned until they accept. Omit `assigneeName` to let CareCircle suggest who to ask and say why. |
| `respond_to_request` | `obligationId`, `accepted`, `note?` | The asked person's answer. `accepted: false` is kept as information, not discarded. |
| `get_my_requests` | – | "What have I been asked to do?" Read-only. Use before `respond_to_request` when the id is not known. |
| `run_care_agent` | `dryRun?` | Lets CareCircle look for slipping work itself and ask an owner - never assigns. `dryRun` reports what it would do without doing it. |

### Reading the situation

| Tool | Arguments | Notes |
|---|---|---|
| `get_care_summary` | – | How the person being cared for is doing. Read-only. |
| `get_shift_brief` | – | What this shift needs to know. The one read a `helper` is allowed. |
| `notify_member` | `recipientName`, `message` | Records the message, and delivers over SNS when configured. |

### Purchasing

| Tool | Arguments | Notes |
|---|---|---|
| `reorder_prescription` | `medicationName?`, `obligationId?` | Returns a priced **offer** with an ETA. Never charges. |
| `confirm_purchase` | `offerId`, `confirmed` | The human decision that makes it real. |

Purchase follows the same discipline as everything else: the offer is a proposal,
and only a confirmation makes it happen. Storefronts are simulated - no real
payment is taken - but the shape is what a real merchant integration would return.

### Managing the circle

| Tool | Arguments | Notes |
|---|---|---|
| `create_household` | `name`, `timezone`, `callerName`, `spokenAs?` | Bootstrap. `timezone` must be a valid IANA name. |
| `add_member` | `name`, `role`, `spokenAs?`, `subject?` | `manage_circle`. |
| `add_medication` | `name`, `times`, `forMemberId?` | `times` are 24-hour `"HH:MM"`. These are what "no record" is measured against. |
| `remove_member` | `memberId` | `manage_circle`. Destructive; releases their work back to unowned. |

### `get_care_gaps` structured output

```jsonc
{
  "gaps": [{
    "id": "gap_unclaimed_obl_…",
    "kind": "UNCLAIMED",        // | UNCONFIRMED | NEEDS_FOLLOW_UP
    "severity": "HIGH",         // | MEDIUM | LOW
    "spoken": "Drive Mom to cardiology Thursday at 10 AM - nobody has taken this yet.",
    "because": "Confirmed as needed, originally inferred from cardiology appointment.",
    "obligationId": "obl_…",    // null when there is nothing to assign yet
    "score": 17,                // round(cost * pDrop * confidence * 100)
    "factors": { "cost": 1, "pDrop": 0.2876, "confidence": 0.6 }
  }]
}
```

`spoken` is written to be read aloud verbatim - no markdown, no ids, long lists
counted rather than recited. `factors` is the score's derivation, exposed so the
ranking can be audited rather than taken on trust:

- **cost** - harm if dropped (medical 1.0, logistical 0.5, social 0.2)
- **pDrop** - probability it is dropped, from deadline and ageing hazards
- **confidence** - `CONFIRMED` 1.0, `NOT_LOGGED` 0.75, `INFERRED` 0.6

`kind` is where the trust model shows up. **`UNCONFIRMED` means there is no record
— it does not mean the thing did not happen**, and must never be rendered as an
accusation. `obligationId` is `null` for these, because there is nothing to assign:
what they need is a person to say what actually happened.

---

## Resources

| URI | MIME | What |
|---|---|---|
| `carecircle://household/state` | `application/json` | The whole care picture: members, obligations with owner and provenance, gaps, open purchase offers, recent notifications. |
| `ui://carecircle/care-board.html` | `text/html;profile=mcp-app` | The Care Board view. See below. |

## Prompts

| Name | What it asks |
|---|---|
| `daily-check` | Today's summary, then anything that still has no owner. |
| `weekly-review` | What is going to fall through the cracks this week. |

---

## The Care Board (MCP Apps)

`get_care_gaps` is an **MCP App** ([SEP-1865](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/),
spec dialect `2026-01-26`). A host that supports the extension renders an
interactive board; a host that does not ignores the resource entirely and the
spoken answer is unchanged. The view is an enhancement and never a precondition.

The tool advertises its view in **both** metadata spellings, because hosts in the
wild read one or the other and the wrong one fails silently as a board that simply
never appears:

```jsonc
"_meta": {
  "ui": { "resourceUri": "ui://carecircle/care-board.html" },
  "ui/resourceUri": "ui://carecircle/care-board.html"
}
```

The view is one self-contained document - no CDN, no fonts, no network beyond the
host bridge - so it declares empty CSP domain lists: there is nothing to allowlist
and nothing to inject into a page showing a family's medical coordination.

From the board a user can read each gap's provenance, open the arithmetic behind
its ranking, and claim work with a tap. Claiming issues a real `tools/call` to
`claim_obligation` through the host, down the **same authorisation path as speech**
- there is no weaker permission model for clicks - and then sends
`ui/update-model-context` so the model knows what changed and stops offering work
that is already taken.

Verified rendering in MCPJam against this live server.

---

## Running your own

```bash
git clone https://github.com/Osiyomeoh/carecircle && cd carecircle
npm ci
npm run story      # the whole scenario end to end, no AWS and no keys
npm run dev        # the MCP server on :8787 (override with PORT)
npm test           # 290 tests, including adversarial and property-based
```

`npm run story` is the fastest way to understand the system: it plays the demo
household through a full sequence and prints every tool call and result.

### Environment

Everything is optional - with none of it set the server runs in-memory with the
demo household and record-only notifications.

| Variable | Purpose |
|---|---|
| `CARECIRCLE_PROVIDER` | `bedrock` (default) or `gemini`, for the simulator's planner. |
| `AWS_REGION`, `BEDROCK_MODEL_ID` | Bedrock model for the simulator. |
| `GEMINI_API_KEY`, `GEMINI_MODEL_ID` | Gemini alternative. |
| `CARECIRCLE_SNS_TOPIC` | Deliver `notify_member` over SNS instead of recording only. |
| `CARECIRCLE_JWT_CLAIM` | **Opts in to the JWT identity strategy.** The only way to enable it. |
| `CARECIRCLE_MEMBER_MAP` | JSON mapping claim values to member ids. |
| `CARECIRCLE_ALLOW_SELF_SIGNUP` | `true` lets an unknown principal bootstrap a household. Off by default. |
| `PORT` | MCP server port. Defaults to `8787`. |
| `CARECIRCLE_URL`, `SIM_PORT`, `LOG_LEVEL` | Simulator wiring. |

Persistence is in-memory by default and DynamoDB when configured; see
[`PRODUCTION.md`](PRODUCTION.md).

> **Identity in production:** the static bearer tokens are for demos. A real
> deployment sets `CARECIRCLE_JWT_CLAIM` and maps validated claims to members. Do
> not ship opaque shared tokens to real families.

---

## See also

- [`DESIGN.md`](DESIGN.md) - why the model is EVENTS → OBLIGATIONS → OWNERSHIP
- [`FRICTION-LOG.md`](FRICTION-LOG.md) - where the protocol and platform got in the way
- [`FEATURE-REQUESTS.md`](FEATURE-REQUESTS.md) - what we wished existed, and what has since arrived
- [`HANDOFF.md`](HANDOFF.md) - operational state, deploys, and gotchas
