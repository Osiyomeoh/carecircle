# Production readiness - hardening program

CareCircle is already production-*aware*: env-selected DynamoDB, JWT-behind-gateway
identity, diff-based writes, a deployable image, health checks, IAM. This document
tracks the work to make it production-*ready* - able to serve real families beyond
the seeded demo - sequenced so each increment is coherent, verified, and safe.

Principle: nothing here weakens the demo. `npm run story` and `npm run demo:reset`
must keep working at every step. Every increment ships with tests and a green
typecheck.

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done

---

## Increment 1 - Runtime hygiene (foundational, low risk) - DONE
The floor every other increment stands on. No domain changes.

- [x] **Demo-seed is gated out of production.** `loadConfig` sets `seedDemo=false`
      under JWT identity (and refuses `CARECIRCLE_SEED_DEMO=true` there). Verified:
      JWT + fresh store → households:0; static + fresh → households:1.
- [x] **Structured logging.** `src/obs/log.ts` - JSON in production, terse lines
      locally, PHI kept out of every field. No console.log in the request path.
- [x] **Graceful shutdown.** SIGTERM/SIGINT stop accepting, drain in-flight requests
      (10s cap), `store.quiesce()` finishes the current write, then exit.
- [x] **Boot-time config validation.** `src/config.ts` fails fast on a table with no
      region, a bad port, a malformed boolean. 9 tests in `config.test.ts`.
- [x] **Request + error middleware.** One access line per request (no body/query);
      a JSON-RPC 500 for any unhandled throw, stack to the logs only.

Result: 79 tests green (+9), typecheck clean, `npm run story` and `demo:reset` intact.

## Increment 2 - Onboarding & multi-tenancy (highest leverage)
Turns a one-family demo into something a second real family can use.

- [ ] Create a household at runtime (name, timezone), returning its id.
- [ ] Add / update / remove members and their roles after creation.
- [ ] Add / edit medication schedules at runtime (today they are seeded).
- [ ] Credential issuance / mapping flow for JWT identity - provision a member's
      claim→id mapping without a redeploy.
- [ ] Provisioning is authorised: only an owner/primary caregiver of a household can
      change its membership; cross-household writes stay impossible.
- [ ] The demo household becomes one tenant among many, not a global assumption.

## Increment 3 - Security & PHI
Care events and medications are health data. Treat them like it.

- [ ] Verify + assert DynamoDB encryption-at-rest (SSE) and TLS in transit.
- [ ] Immutable audit log of every state-changing action (who, what, when, from where).
- [ ] Data retention + erasure honoured through the app (build on `delete-household.sh`).
- [ ] Rate limiting / per-session quotas against abuse and runaway cost.
- [ ] Threat-model pass: injection through note text, cross-household probing,
      credential swap mid-session (extend the adversarial suite).
- [ ] Secrets from a real store (SSM/Secrets Manager), never plaintext env in prod.

## Increment 4 - Delivery & operations
- [ ] `notify_member` delivery with retries + recorded delivery status.
- [ ] Metrics + tracing (tool latency, error rate, gap counts) to CloudWatch/OTel.
- [ ] CI: typecheck + tests + evals on every push; image build on tag.
- [ ] Runbook: deploy, roll back, restore a household, rotate credentials.

---

## Scope honesty (for the hackathon)
Judging rewards MCP quality + ideation and "could this serve an audience beyond the
hackathon" - Increments 1–2 speak directly to that and stay inside the deadline.
Increment 3's full HIPAA posture is a real-world requirement but a post-submission
program; we build the *structure* (audit, encryption assertions, erasure) now and
name the compliance certification as roadmap, not as done.
