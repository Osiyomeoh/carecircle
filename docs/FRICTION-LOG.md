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
- **Workaround:** Import `.ts` specifiers in test files and exclude tests from `tsconfig`,
  so each toolchain sees only the form it accepts. Source files keep `.js`.
- **Suggestion:** Make type stripping resolve `./x.js` to `./x.ts` when the `.js` file does
  not exist and the `.ts` sibling does. Without it, native type stripping cannot be used
  with TypeScript's own recommended `NodeNext` resolution — which undercuts the main
  reason to reach for it.
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
