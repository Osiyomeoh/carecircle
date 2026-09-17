# Open Source mini-challenge - submission


**Published:** https://github.com/Osiyomeoh/care-events (public, MIT). Fields below are filled.
## The contribution: `@carecircle/care-events`

A new, standalone, MIT-licensed, zero-dependency TypeScript package that extracts
CareCircle's core idea into something any project can reuse: **one adapter seam that
turns heterogeneous device signals - voice, wearable, doorbell - into a single
`CareEvent` contract, with a provenance model that never lets a guess become a fact.**

Lives at [`packages/care-events`](../packages/care-events). It builds, typechecks
under `strict` + `exactOptionalPropertyTypes`, and ships with its own `node:test`
suite (5 tests, zero runtime dependencies).

## What / how / why (the required submission fields)

**What.** A device-agnostic library defining the `CareEvent` contract, a `Provenance`
trust model (`CONFIRMED` / `INFERRED` / `NOT_LOGGED`), a `SignalAdapter<Raw>`
interface, and two working adapters (`ringAdapter`, `beeAdapter`). Adding a new
device is one adapter and nothing else.

**How.** Each adapter maps a raw payload to zero or more `CareEvent`s. The contract
enforces the one rule that makes such a system trustworthy: adapters *classify*, they
never *assert*. A Ring package delivery enters as `INFERRED` evidence that a package
arrived - never a conclusion that an errand is done. A Bee conversation fact enters as
`INFERRED` until a human confirms it. Downstream, a Bee fact and a Ring doorbell are
indistinguishable - which is exactly what lets one engine serve every surface.

**Why it matters.** Most home-care and household-coordination tools are welded to a
single device SDK. This package is a reusable integration *pattern*: it lets any
developer wire a new signal source (an Alexa+ MCP tool, a wearable, a camera, a
sensor) into a shared care record without re-deriving the trust model each time. It
is the seam that makes cross-device coordination tractable, released so others do not
have to rebuild it.

## To make it count as a distinct contribution (publish steps)

The mini-challenge wants a separate open-source artifact alongside the primary track
submission. `packages/care-events` is self-contained precisely so it can be lifted
out into its own public repository:

```bash
# from the repo root
cp -r packages/care-events /tmp/care-events && cd /tmp/care-events
git init && git add -A && git commit -m "care-events: one adapter seam any device plugs into"
gh repo create care-events --public --source=. --push   # its own repo, MIT license visible
# optional: npm publish --access public
```

## Submission form fields (fill the URLs after publishing)

- **Contribution URL:** `https://github.com/Osiyomeoh/care-events` (or the first commit/PR URL)
- **Project repository URL:** `https://github.com/Osiyomeoh/care-events`
- **GitHub username:** `Osiyomeoh`
- **Description:** the What / How / Why above, condensed to a paragraph.

## Rubric note

The Open Source rubric calls a "meaningful feature addition with tests" or a "new
integration pattern" *creative*, versus a README/typo fix as *obvious*. This is a new
integration pattern with tests and a trust model - squarely the creative end.
