# Plan: a real 10 on every criterion

**Deadline: Friday 23 October 2026, 12:00pm PT.** Today is 14 September — **39 days.**
Judging 9–20 November. Winners 3 December.

Target: Alexa+ 1st ($25,000) + AWS Builder ($5,000) + Open Source ($5,000) = **$35,000
cash + $20,000 AWS credits.** A project may win one track prize and one mini
challenge, so these three are the maximum reachable from one submission.

---

## Part 1 — What a 10 actually means

Not "good". A 10 is the submission a judge uses as the reference point for every
other submission they score that day.

### Tech Implementation — 10 = "this is production code, not a hackathon build"

The rules ask how well it is built and how effectively it uses the required tech.
The rubric's own "obvious" example is *a basic MCP wrapper around an existing API*.

A 10 requires all of:

- [ ] MCP spec 2025-11-25 over Streamable HTTP, session-bound identity ✅ **done**
- [ ] Deterministic domain logic, not model narration ✅ **done**
- [ ] **Measured tool-selection accuracy** published in the README — an eval harness
      over ~150 real utterances. Nobody else will have a number.
- [ ] **Hosted on Bedrock AgentCore Runtime** — not a laptop, not a bare container
- [ ] Multi-service AWS pipeline: AgentCore + Strands + Bedrock + SNS
- [ ] >40 tests, typed strictly, CI green on every push
- [ ] Adversarial tests: credential swap mid-session, cross-household access,
      privilege escalation, prompt injection through note text

The line that wins it: *"we measured how well the model chooses our tools, found
nine failures, and fixed them."*

### Design — 10 = "this is a product, and I understood it in ten seconds"

- [ ] The simulated Alexa+ experience is visually excellent ✅ **largely done**
- [ ] Rich cards with bound actions ✅ **done**
- [ ] A scenario seed so every frame matches the narration (cardiology really is
      Thursday at 10:00)
- [ ] Screen device *and* headless device rendering — the same answer degrading
      gracefully to speech proves the multi-modal argument
- [ ] A 3-minute video with no dead air, no setup, no terminal
- [ ] The care board readable at 720p on a laptop — judges do not full-screen

### Potential Impact — 10 = "I know someone who needs this"

- [ ] **One real caregiver on camera for 30 seconds.** The single highest-value
      artefact available and the only one that cannot be built.
- [ ] Sized market stated once, with a source
- [ ] A deployed URL a judge can use themselves — **required by the rules** to remain
      free and unrestricted until judging ends 20 November
- [ ] The Alexa Together answer ✅ **done** — turns the obvious objection into evidence
      of ecosystem understanding

### Quality of the Idea — 10 = "I have not seen this before"

The rubric names as creative: *agentic workflow orchestrating across services*,
*context-aware add-on maintaining state across sessions*, *media support*.

- [ ] State across sessions ✅ **done** — the household record is the product
- [ ] Media support ✅ **done** — cards with actions
- [ ] **Orchestration across services** — currently missing. `notify_member` must
      actually deliver (SNS/SES), not just record an event.
- [ ] Care Gaps as a repeatable phrase ✅ **done**
- [ ] Constraint discovery ✅ **done** — *"I can't drive Thursday"* orphans work
      nobody realised had come loose. This is the most original thing we have.

### AWS Builder — 10 = a pipeline, not a call

The rubric is explicit. *Obvious: single Bedrock call.* **That is what we have today.**
*Creative: multi-service pipeline (Bedrock + AgentCore + Strands), agent orchestration.*

- [ ] MCP server on **AgentCore Runtime**
- [ ] Simulator agent on **Strands Agents SDK**
- [ ] **SNS/SES** for real notification delivery
- [ ] Architecture diagram + written integration notes in the feedback field
- [ ] Fallback hedge: **Kiro Crew** qualifies on its own as a development tool

### Open Source — 10 = a merged fix that unblocks other developers

*Obvious: README update, typo fix.* *Creative: meaningful feature addition with tests,
bug fix that unblocks other developers.*

- [ ] PR to `modelcontextprotocol/typescript-sdk`: transports are not assignable to
      `Transport` under `exactOptionalPropertyTypes` — **with a regression test**,
      which is what separates "creative" from "typo fix"
- [ ] CareCircle itself as a reusable OSS project: contribution guide, extension
      docs, issues labelled `good first issue`
- [ ] File the friction-log findings as upstream issues, linked from the submission

### Friction bonus — 10 = the best feedback Amazon receives

Applied by Amazon's internal team at **Stage One**, before the judging panel sees
anything. It affects whether we are shortlisted at all.

- [ ] 12+ entries, every one from real work ✅ **6 so far**
- [ ] Entries across MCP SDK, Bedrock, AgentCore, Strands, Alexa+ docs
- [ ] Every entry ends in a concrete, actionable suggestion ✅ **format established**

---

## Part 2 — The 39 days

### Sprint 1 · 14–20 Sept — unblock and measure

**The critical path runs through AWS access. Nothing else matters this week.**

| # | Work | Owner |
|---|---|---|
| 1.1 | `bedrock:InvokeModel` + model access, us-east-1 | **You** |
| 1.2 | Claim $150 AWS credits (form closes 21 Oct); builder.aws.com account | **You** |
| 1.3 | Register on Devpost | **You** |
| 1.4 | **Start asking caregivers.** Longest lead time on the board. | **You** |
| 1.5 | SDK PR with regression test | Me |
| 1.6 | Scenario seed — `npm run demo:reset` stages the exact opening state | Me |
| 1.7 | Eval harness v1: 60 utterances, tool-selection accuracy | Me |
| 1.8 | Fix what the evals expose (incl. the `get_care_summary` overlap question) | Me |

**Exit:** Bedrock works, first accuracy number exists.

*Status 15 Sept:* scenario seed, eval harness, adversarial suite, DynamoDB
persistence, pluggable identity and the Bedrock preflight are all done. The SDK PR
turned out to be already fixed upstream. The accuracy number is the only item still
blocked, and only by the quota hold — the harness is built and verified, so it
produces the number within minutes of quota landing.

### Sprint 2 · 21–27 Sept — the AWS pipeline

Moves AWS Builder from 4 to 8.5 and closes the orchestration gap on the main track.

| # | Work |
|---|---|
| 2.1 | MCP server on **AgentCore Runtime**, public URL |
| 2.2 | Rebuild the simulator agent loop on **Strands Agents SDK** |
| 2.3 | `notify_member` delivers for real via **SNS** |
| 2.4 | Architecture diagram: Alexa+ → AgentCore → CareCircle → Bedrock/Strands → SNS |
| 2.5 | Friction entries for AgentCore, Strands, SNS — richest source left |
| 2.6 | Deployment must survive to 20 Nov: budget alarm, no expiring creds |

**Exit:** a URL a judge can use, running a multi-service AWS pipeline.

### Sprint 3 · 28 Sept–4 Oct — hardening and proof

| # | Work |
|---|---|
| 3.1 | Eval harness to 150 utterances across all four members; publish the number |
| 3.2 | Rewrite the tool descriptions the evals show are weak; re-measure |
| 3.3 | Adversarial suite: credential swap, cross-household, escalation, injection |
| 3.4 | Headless (speech-only) rendering path alongside the screen device |
| 3.5 | CI: tests + typecheck + evals on every push |
| 3.6 | CONTRIBUTING.md, extension guide, `good first issue` labels |

**Exit:** >40 tests, a published accuracy figure, adversarial demo ready to film.

### Sprint 4 · 5–11 Oct — the video

The highest-variance artefact. A working server nobody can see loses to a worse
project with a better film.

| # | Work |
|---|---|
| 4.1 | Script to the second. Beat 1 is constraint discovery, not medication logging. |
| 4.2 | Film the caregiver segment |
| 4.3 | Screen capture at 1080p, scenario seed, no terminals |
| 4.4 | Edit to **under 2:30** — 30 seconds of headroom against the 3:00 cap |
| 4.5 | Watch it muted, then watch it without the picture. Both must work. |

**Video structure (2:30):**

```
0:00-0:20  The problem. Renee says she can't drive Thursday.
           Nobody creates a task. The ride comes loose.
0:20-0:45  David: "what's going to fall through the cracks this week?"
           Care Gaps board. He claims it by voice. State changes on screen.
0:45-1:10  Known != Assumed. "No record of her evening dose" — never "she missed it."
           Show the test that enforces it.
1:10-1:35  One record, four people. Renee refused the assign. The aide scoped out.
1:35-2:00  Architecture: MCP 2025-11-25, AgentCore, Strands. Tool-selection accuracy.
2:00-2:20  The real caregiver.
2:20-2:30  Alexa Together: we did not rebuild it. Here is what we built instead.
```

**Exit:** final cut uploaded, unlisted, watched by someone who has never seen it.

### Sprint 5 · 12–18 Oct — the submission is a deliverable

Most entrants write this in the last hour. It is scored.

| # | Work |
|---|---|
| 5.1 | Product feedback per tool: MCP SDK, Bedrock, AgentCore, Strands, SNS, Alexa+ docs |
| 5.2 | Friction log to 12+ entries, final pass for clarity |
| 5.3 | Feature requests finalised with priority ratings |
| 5.4 | Open Source fields: contribution URL, repo URL, GitHub username, description |
| 5.5 | AWS Builder field: which services, how, why that shape |
| 5.6 | README final: deployed URL first line; verify GitHub shows MIT in **About** |
| 5.7 | Clone the repo into a clean directory and follow the README literally |

**Exit:** every field drafted. Nothing left that needs thought.

### Sprint 6 · 19–23 Oct — submit early

| # | Work |
|---|---|
| 6.0 | **Make the repo public.** It is private during development; the rules require a public repo with the licence visible in GitHub's About panel, and a private repo fails Stage One. |
| 6.1 | **Submit Tuesday 21 Oct** — two days of margin, not two hours |
| 6.2 | Confirm the deployed URL is up and unauthenticated |
| 6.3 | Confirm the video is public and plays logged out |
| 6.4 | Read the rules once more against the submission |
| 6.5 | Remaining time: only fixes, no new features |

---

## Part 3 — Critical path and risk

```
AWS access ─┬─> AgentCore hosting ──> public URL ──> judge can test
            ├─> Strands agent loop ──> AWS Builder score
            └─> eval harness runs ──> accuracy number ──> Tech Implementation

caregiver outreach ────────────────────────> footage ──> Potential Impact
      (start now; longest lead time, no fallback)

SDK PR ──> review latency ──> merged ──> Open Source score
   (file early; merge timing is outside our control)
```

| Risk | Severity | Mitigation |
|---|---|---|
| AWS access stays blocked | **critical** | Kiro Crew hedge for AWS Builder; simulator runs on any Bedrock-capable account, including a fresh one |
| No caregiver found | high | Start week 1. Fallback: a caregiver reading a written quote off-camera, or a support-forum quote with permission |
| SDK PR not merged by 23 Oct | medium | Rules say PRs need not be merged; a fork with tests qualifies |
| AgentCore proves painful | medium | Fargate/Lambda fallback; the pain itself becomes friction-log material |
| Deployment dies before 20 Nov | high | Budget alarm, no trial credits, calendar reminder for 1 Nov |
| Scope creep | high | **Bee stays gated. Fire TV stays dead.** No new domain features after 4 Oct. |
| Video overruns | medium | Cut to 2:30; judges need not watch past 3:00 |

---

## Part 4 — What we are not doing

Naming these once so they stop costing attention:

- **Bee** — no prize multiplier, and one project wins one track
- **Fire TV** — a second mediocre surface
- **Ring** — same
- Emergency detection, health analytics, medication recommendations, a caregiver
  social network, thirty tools

The submission that wins is narrow and finished, not broad and nearly done.

---

## Part 5 — Definition of done

Submission is ready when all are true:

- [ ] A judge can open a URL and use CareCircle without credentials or setup
- [ ] The repo clones and runs from the README on a clean machine
- [ ] **The repo is public** (private during development — must be flipped before submitting)
- [ ] GitHub's About section shows the MIT licence
- [ ] The video is under 2:30, public, and works muted
- [ ] Tool-selection accuracy is measured and published
- [ ] The AWS pipeline is genuinely multi-service and documented
- [ ] The SDK PR is filed with a regression test
- [ ] 12+ friction entries, every one actionable
- [ ] A real caregiver says one true sentence on camera
- [ ] Submitted by Tuesday 21 October
