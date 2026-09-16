# Friction log

Running log kept **while building** (worth up to a 10% judging bonus; worthless if
reconstructed at the end). One entry per friction point.

Template:

```
### [tool/SDK] — short title
- **Task attempted:**
- **Steps taken:**
- **Expected:**
- **Actual:**
- **Severity:** blocker / major / minor
- **Workaround:**
- **Suggestion:**
- **Date:**
```

---

### MCP TypeScript SDK — no published support matrix for spec versions
- **Task attempted:** Confirm the SDK supports spec 2025-11-25, which the hackathon requires.
- **Steps taken:** Checked npm for the latest version, then grepped `dist/esm/types.js`
  for the protocol constants because the README and npm page state neither the
  supported spec versions nor which SDK release introduced them.
- **Expected:** A support matrix in the README, or a documented
  `SUPPORTED_PROTOCOL_VERSIONS` export, mapping SDK version -> spec version.
- **Actual:** Found it only by reading compiled source:
  `LATEST_PROTOCOL_VERSION = '2025-11-25'` in 1.30.0.
- **Severity:** minor
- **Workaround:** grep the installed package.
- **Suggestion:** Publish a spec-version support matrix in the README and in the npm
  description. Developers targeting a specific spec version (as required by, e.g.,
  hackathon or enterprise compliance rules) currently cannot tell which SDK release
  to pin without reading build output.
- **Date:** 2026-09-14

### Node 24 type stripping — `.js` import specifiers do not resolve to `.ts`
- **Task attempted:** Run `node --test src/domain/gaps.test.ts` on a TypeScript test file,
  using Node 24's built-in type stripping instead of adding a test-runner dependency.
- **Steps taken:** Wrote the test with `import ... from './gaps.js'` — the specifier form
  TypeScript's `NodeNext` module resolution *requires* in source files.
- **Expected:** Node resolves `./gaps.js` to the sibling `gaps.ts`, the way `tsx` and
  `ts-node` do, since it is already stripping types for that file.
- **Actual:** `ERR_MODULE_NOT_FOUND` for `src/domain/gaps.js`. Node resolves the literal
  specifier and never considers the `.ts` sibling.
- **Severity:** major — the two tools disagree about the same import, so a file cannot
  satisfy `tsc --noEmit` and `node --test` at once without a build step or a loader.
- **Workaround:** Initially, import `.ts` specifiers in test files and exclude tests from
  `tsconfig`. **This stops working the moment a test imports real source** — the source
  file's own `.js` imports fail the same way, one level down. The only durable fix was to
  abandon native type stripping for tests and run them through `tsx`, which resolves the
  specifiers TypeScript requires.
- **Suggestion:** Make type stripping resolve `./x.js` to `./x.ts` when the `.js` file does
  not exist and the `.ts` sibling does. Without it, native type stripping cannot be used
  with TypeScript's own recommended `NodeNext` resolution — which undercuts the main
  reason to reach for it: avoiding a build step or a loader dependency. We ended up adding
  the loader dependency anyway, which is the outcome the feature exists to prevent.
- **Date:** 2026-09-14

### Node 24 type stripping — parameter properties are rejected at runtime
- **Task attempted:** Run tests against source using TypeScript parameter properties
  (`constructor(public readonly capability: Capability)`), a standard idiom for
  typed error classes.
- **Steps taken:** `tsc --noEmit` passed cleanly. `node --test` on the same files failed.
- **Expected:** Either both tools accept the code, or `tsc` warns that the syntax is
  incompatible with Node's strip-only mode when the project targets it.
- **Actual:** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not
  supported in strip-only mode` — at runtime, per file, only when that file is loaded.
  The type checker gives no hint, so the failure surfaces late and one file at a time.
- **Severity:** major — valid, type-checked TypeScript that crashes only at runtime.
- **Workaround:** Declare fields explicitly and assign in the constructor body.
- **Suggestion:** Ship a `tsconfig` flag (e.g. `"erasableSyntaxOnly"` surfaced in
  `--init` templates) that makes `tsc` reject non-erasable syntax up front, and mention
  the strip-only restrictions in Node's own type-stripping docs with the full list —
  parameter properties, enums, namespaces, decorators — rather than leaving developers
  to discover them one runtime crash at a time.
- **Date:** 2026-09-14

### MCP TypeScript SDK — transports are not assignable to `Transport` under `exactOptionalPropertyTypes`
- **Task attempted:** `await server.connect(transport)` with
  `StreamableHTTPServerTransport`, in a project using TypeScript's
  `exactOptionalPropertyTypes: true`.
- **Steps taken:** Standard usage, straight from the SDK's own documented example.
- **Expected:** The SDK's own transport satisfies the SDK's own `Transport` interface.
- **Actual:** `TS2379: Argument of type 'StreamableHTTPServerTransport' is not assignable
  to parameter of type 'Transport' with 'exactOptionalPropertyTypes: true'`. The
  interface declares `onclose?: () => void`, while every transport implementation
  exposes accessors typed `(() => void) | undefined`. Those are not assignable under
  this flag, so **no strict consumer can connect any SDK transport without a cast.**
- **Severity:** major — the SDK is unusable as documented under a recommended strictness
  setting, and the error message points at the consumer rather than the SDK.
- **Workaround:** Cast at the call site (`transport as unknown as Parameters<...>[0]`),
  which discards real type safety at exactly the boundary where you want it.
- **Suggestion:** Declare the optional handler members on `Transport` as
  `onclose?: (() => void) | undefined` (likewise `onerror`, `onmessage`). This is the
  standard fix for `exactOptionalPropertyTypes` compatibility, is backwards compatible
  for every existing consumer, and costs nothing. Worth adding the flag to the SDK's own
  `tsconfig` so the incompatibility is caught in CI.
- **Update (verified upstream):** `main` already carries exactly this fix —
  `onclose?: (() => void) | undefined` — but it has not been released; the published
  1.30.0 still has the broken declaration. So the remaining friction is release
  cadence rather than the bug: every current consumer hits it with no way to tell
  from npm that a fix exists. A note in the README, or a patch release for a fix that
  blocks a documented usage pattern under a recommended compiler flag, would close it.
- **Date:** 2026-09-14

### MCP TypeScript SDK — "Server not initialized" does not say what is actually wrong
- **Task attempted:** Serve Streamable HTTP by creating a fresh `McpServer` and transport
  per HTTP request.
- **Steps taken:** POST `initialize`, then let the client send `notifications/initialized`.
- **Expected:** Either it works, or an error explaining that sessions span requests.
- **Actual:** `400 Bad Request: Server not initialized` on the *second* request. The
  message describes a state, not the cause. The real problem is that a stateful session
  must be reused across requests and keyed by `Mcp-Session-Id` — the server object cannot
  be per-request.
- **Severity:** minor (a correct design is documented; the diagnostic is the problem)
- **Workaround:** Keep a `Map<sessionId, {server, transport}>`, create on `initialize`,
  look up on subsequent requests, and clean up via `onsessionclosed`/`onclose`.
- **Suggestion:** Make the error say what to do: "No session found for this request. In
  stateful mode, reuse the transport for a given Mcp-Session-Id; create a new one only
  for initialize requests." A short "sessions span requests" note near the top of the
  Streamable HTTP docs would prevent the whole class of mistake.
- **Date:** 2026-09-14

### Bedrock — no way to discover which models you can actually call
- **Task attempted:** Pick a valid Claude model id for `ConverseCommand` from a developer
  account, for an agent loop driving an MCP server.
- **Steps taken:** Guessed an id from the docs' naming pattern; got
  `ValidationException: The provided model identifier is invalid.` Tried to enumerate
  with `ListInferenceProfiles`; got `AccessDenied` for that action. Fell back to probing
  candidate ids one at a time against `Converse` and reading the error types apart.
- **Expected:** One call that answers "what can this principal invoke right now?"
- **Actual:** Three different failure modes that have to be told apart by hand:
  `ValidationException` (id malformed or nonexistent), `ResourceNotFoundException`
  ("this model version has reached the end of its life"), and `AccessDeniedException`
  (the id is real and you lack permission). Only the third confirms an id is correct —
  so the way to verify a model id is to be denied access to it.
- **Severity:** major — a first-run blocker for anyone whose account is not already set
  up, and the error text does not point at the fix.
- **Workaround:** Script a probe across candidate ids and treat `AccessDenied` as proof
  the id is valid.
- **Suggestion:** (1) Let `ListFoundationModels`/`ListInferenceProfiles` be readable by
  default, or provide a `GetInvokableModels` that needs no extra grant. (2) Make the
  invalid-identifier error name the nearest valid ids. (3) In the console, show the
  exact `modelId` string to paste next to each model, including the regional inference
  profile prefix — the `us.` prefix is easy to miss and produces the same opaque error.
- **Date:** 2026-09-14


### Bedrock — daily token quota is invisible until you hit it
- **Task attempted:** Run a 68-case tool-selection evaluation through `Converse`.
- **Steps taken:** Ran the suite; every case returned
  `ThrottlingException: Too many tokens per day, please wait before trying again.`
- **Expected:** To know the daily budget and how much is left *before* starting a run —
  or at minimum, for the error to say when the quota resets.
- **Actual:** No figure, no reset time, no console page showing consumption against a
  daily token quota. The only way to discover the limit is to exhaust it, and the only
  way to discover it has reset is to retry. Quotas are also per region, which is not
  obvious: the same model was throttled in one region and denied outright in another,
  producing two different errors for what looked like one problem.
- **Severity:** major for anything batch-shaped — evals, backfills, any workload that
  issues many small calls. It is unplannable.
- **Workaround:** Exclude throttled cases from results rather than scoring them as
  failures. There is no second lane: we assumed the quota was per region and enabled a
  second one, but `us-east-1`, `us-east-2` and `us-west-2` all return the identical
  message for both Sonnet 4.5 and Haiku 4.5, so the budget is account-wide and spans
  models. Nothing in the error says that, and we only established it by probing.
- **Also:** `servicequotas:ListServiceQuotas` is denied by default, so a developer who
  hits this cannot even read what the limit is or whether it is adjustable without
  going back to an administrator for another permission.
- **Suggestion:** (1) Surface daily token consumption and the remaining budget in the
  Bedrock console and via an API readable with plain Bedrock access, the way Service
  Quotas does for request rates.
  (2) Include the reset time in the `ThrottlingException` message. (3) Distinguish
  "rate limited, retry shortly" from "daily budget exhausted, retry tomorrow" — they
  call for completely different client behaviour, and today both arrive as
  `ThrottlingException`. (4) State the scope in the message — account-wide across
  regions and models, which is the opposite of what a developer familiar with
  regional service quotas will assume, and costs real time to discover by probing.
- **Date:** 2026-09-14


### Bedrock — "Too many tokens per day" is reported when the quota is zero
- **Task attempted:** Run a tool-selection evaluation, then diagnose why every call failed.
- **Steps taken:** Every `Converse` call returned
  `ThrottlingException: Too many tokens per day, please wait before trying again.`
  We checked other regions, then other model families, then compared the account's
  applied quotas against the AWS defaults.
- **Expected:** That message to mean what it says — a budget consumed, refilling later.
- **Actual:** The account's applied value for
  `Cross-region model inference tokens per minute for Anthropic Claude Sonnet 4.5`
  (`L-8EA73537`) is **0**, against an AWS default of **1,000,000**. Every Bedrock
  inference quota on the account is 0, across all vendors, for both tokens per day and
  requests per minute. Nothing had been consumed. There was never any capacity to
  consume, and waiting would never have helped.
- **Severity:** blocker, and the wrong diagnosis is the expensive part. The message
  describes exhaustion, so we spent time looking for the workload that drained the
  budget, checking whether credits had run out, and enabling a second region on the
  assumption that quotas were regional. All of that was wasted: the true state was
  "this account has no Bedrock capacity allocated."
- **Workaround:** None available to the developer. The quota has to be raised, and the
  daily-token quotas are marked non-adjustable, so it appears to need AWS Support.
- **Suggestion:** (1) Distinguish "you have used your quota" from "your quota is zero".
  They are completely different situations and only one of them is worth waiting out.
  A zero quota should return something like *"This account has no on-demand inference
  quota for this model. Request an increase or contact support."* (2) Surface the
  applied-vs-default quota in the Bedrock console, since a value of 0 against a default
  of 1,000,000 is instantly diagnostic and currently takes a Service Quotas comparison
  to discover. (3) `ThrottlingException` is the wrong error class for a permanent
  condition — clients retry it by default, which here means retrying forever.
- **Date:** 2026-09-14


### Service Quotas — a zeroed quota cannot be restored through Service Quotas
- **Task attempted:** Request a Bedrock inference quota increase after discovering the
  account's applied quota was 0.
- **Steps taken:** `aws service-quotas request-service-quota-increase --quota-code
  L-F4DDD3EB --desired-value 200000` — a modest value, far below the AWS default of
  5,000,000, and far more than enough for the workload.
- **Expected:** A request to raise an applied quota from 0 to 200,000 to be accepted.
- **Actual:** `IllegalArgumentException: You must provide a quota value greater than the
  default quota value of 5000000.0`. The API validates the desired value against the
  **default**, not against the account's **applied** value. With an applied quota of 0
  and a default of 5,000,000, the only requests it will accept are for *more than* the
  default — so there is no way to ask to be restored *to* it.
- **Severity:** blocker. The self-service path for quota problems cannot address the
  most severe quota problem there is: having none. The only remaining route is a support
  case, and the Support API is unavailable on Basic support, so it is console-only.
- **Workaround:** None through the API. Either file a console support case, or request a
  dishonestly inflated value above the default purely to satisfy the validator.
- **Suggestion:** Validate `desiredValue` against the account's applied quota, not the
  default. A request that raises an applied value is legitimate whether or not it reaches
  the default — and "my quota is below default and I would like the default" is the most
  natural request a customer can make. At minimum, the error should say what the applied
  value is and direct the customer to support when it is below default.
- **Date:** 2026-09-14


### Gemini free tier — multi-turn tool loops are unusable under rate limits
- **Task attempted:** Drive the simulated Alexa+ agent loop with Gemini while the
  Bedrock account quota is being restored, to iterate on tool descriptions.
- **Actual:** Single-turn requests (one tool call) succeed. Multi-turn requests — e.g.
  "I'll take the cardiology one", which needs get_care_gaps then claim_obligation —
  issue several model calls in seconds and reliably trip 429/503 partway through. With
  backoff, one conversational turn can take 30s+ or fail. gemini-2.5-flash and
  gemini-2.0-flash are also listed by models.list() but return 404 on use.
- **Severity:** minor for us (the submission demo runs on Bedrock/Claude; Gemini is only
  a stopgap for description iteration), but worth recording as cross-provider friction.
- **Workaround:** Retry transient errors with backoff at the turn boundary; pace eval
  cases ~6s apart. A paid tier removes it.
- **Date:** 2026-09-16


### Ring Partner API — webhook event types are listed, but the payload schema is not
- **Task attempted:** Build an adapter from Ring webhook events to CareCircle's care
  signals, matching Ring's real event contract rather than an invented shape.
- **Steps taken:** Read the Ring API reference. It documents the event *types*
  (`motion_detected` with `attributes.sub_type`, `button_press`, device-lifecycle and
  subscription events), the JSON:API envelope, HMAC-SHA256 `X-Signature` verification,
  and that metadata carries `account_id` and `request_id` for idempotency.
- **Expected:** A complete JSON schema (or a documented example payload) for each event
  type — exact field names and nesting — so an integration can be written against it.
- **Actual:** The published docs stop at the type list and envelope. The precise field
  names, nesting, and full attribute set for a webhook payload are not given; the
  reference effectively points you to support or SDK source to discover them.
- **Severity:** major for a webhook integration — you cannot parse events reliably from
  the docs alone, and webhook handlers are exactly where you want certainty.
- **Workaround:** Model defensively against the guaranteed fields (type, device id,
  `created_at`, `sub_type`, `request_id`) and ignore the rest; treat a
  package/delivery as `motion_detected` with a package `sub_type`, since Ring has no
  distinct delivery event.
- **Suggestion:** Publish a full example payload per event type, or a JSON Schema, next
  to the type table. One concrete `motion_detected` example with the `attributes` and
  `relationships` filled in would remove the guesswork entirely.
- **Date:** 2026-09-16

### Bedrock — a model-access grant does not imply the caller can invoke the model
- **Task attempted:** Invoke Claude Sonnet 4.5 immediately after receiving the email
  confirming our account had been granted access to the model.
- **Steps taken:** Ran `aws bedrock-runtime converse --model-id
  us.anthropic.claude-sonnet-4-5-...` with the credentials the account normally uses.
- **Expected:** With model access granted, an authenticated principal on the account
  can call the model.
- **Actual:** `AccessDeniedException: not authorized to perform bedrock:InvokeModel ...
  because no identity-based policy allows the action`. Model access (an account-level
  grant) and IAM permission (an identity policy on the calling user/role) are two
  independent gates, and the failure looked identical to the earlier quota hold.
- **Severity:** major — after a multi-day wait for access, the first call still fails,
  and the error does not say the *account* is fine and only the *principal* is missing a
  permission. Easy to misread as "the grant didn't actually land."
- **Workaround:** Switch to a principal that carries `bedrock:InvokeModel` (we keep a
  dedicated `conductor` IAM user with the inference policy), or attach the action.
- **Suggestion:** In the model-access confirmation, state that the caller still needs
  `bedrock:InvokeModel` on the target inference-profile ARN, and have the runtime error
  distinguish "account has no model access" from "this principal lacks InvokeModel".
- **Date:** 2026-09-16

### Bedrock — the newer Claude models must be called by inference-profile id, not model id
- **Task attempted:** Call Claude Sonnet 4.5 by what looks like its model id.
- **Steps taken:** Reached for a foundation-model style id first; the working id turned
  out to be the cross-region *inference profile* `us.anthropic.claude-sonnet-4-5-...`
  (note the leading `us.`), and the IAM resource is
  `arn:aws:bedrock:...:inference-profile/us.anthropic...`, not `foundation-model/...`.
- **Expected:** One obvious identifier to invoke a model, matching what the console lists.
- **Actual:** Two identifier shapes (foundation-model vs inference-profile) that are easy
  to confuse; an IAM policy scoped to `foundation-model/*` silently fails to authorize an
  inference-profile invoke, producing an AccessDenied that names the profile ARN.
- **Severity:** minor — once known it is a one-time fix, but it costs a debugging loop.
- **Workaround:** Use the `us.`-prefixed inference-profile id everywhere, and scope IAM
  to the inference-profile resource (or `*`).
- **Suggestion:** In the model catalogue/console, label plainly which id to pass to
  `InvokeModel`/`Converse` and which ARN to put in IAM, side by side, for each model.
- **Date:** 2026-09-16

### Bedrock / Service Quotas — you cannot self-diagnose readiness without a second permission
- **Task attempted:** Have the app pre-flight its own Bedrock readiness (is the quota
  non-zero, is access live) before a demo, so a failure is explained, not opaque.
- **Steps taken:** Called `servicequotas:ListServiceQuotas` / `GetServiceQuota` for the
  Bedrock per-model quota from the same principal that invokes the model.
- **Expected:** A principal allowed to invoke a model can read that model's own quota to
  report headroom.
- **Actual:** Reading the quota requires a separate `servicequotas:*` permission the
  invoke principal usually does not have, so the preflight reports "quota state unknown"
  even when invocation works. Diagnosing the *quota=0* failure mode needs a permission
  you are unlikely to have granted just to run inference.
- **Severity:** minor — the app degrades to "unknown" rather than a clear readiness line.
- **Suggestion:** Expose a lightweight, invoke-scoped readiness signal (e.g. remaining
  daily tokens) on the Bedrock runtime API itself, so an app can self-report headroom
  without granting Service Quotas read access to its inference role.
- **Date:** 2026-09-16
