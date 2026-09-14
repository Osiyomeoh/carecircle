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
