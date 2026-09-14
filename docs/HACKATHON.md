# Submission checklist — Amazon Developer Hackathon

**Deadline: Oct 23, 2026 @ 7:00pm UTC**
Primary track: **Alexa+ (MCP)** · Mini challenges: **AWS Builder** + **Open Source**

## Hard requirements

- [ ] Self-hosted MCP server, **spec 2025-11-25+, Streamable HTTP**
      (SDK 1.30.0 `LATEST_PROTOCOL_VERSION = '2025-11-25'` — satisfied by transport)
- [ ] Public GitHub repo, all source + assets + run instructions
- [ ] **Open-source license visible in the repo About section** (not just LICENSE file)
- [ ] Repo must *actually call* MCP in code — import, entry point, loaded config.
      A README mention is explicitly not enough.
- [ ] Demo video **under 3 minutes**, public, English, YouTube or Vimeo.
      No third-party trademarks or unlicensed music.
- [ ] Text description: what it does, how it works
- [ ] Track + mini challenges declared

## Free points most entrants skip

- [ ] **Friction log — up to 10% judging bonus.** Per entry: task attempted,
      steps taken, expected vs actual, severity, workaround, actionable suggestion.
      Keep a running log *while building*; it is worthless reconstructed at the end.
- [ ] **Product feedback on every tool/API/SDK used**: what for, what worked,
      what needs work, onboarding, would you build with it again. Required field —
      Amazon said outright they want this. Treat it as scored, not decorative.
- [ ] Feature requests (optional): what, why, urgency (critical/important/nice-to-have)

## Mini challenge requirements

**AWS Builder** — documented integrations, described in its own form field.
Plan: MCP server hosted on **Bedrock AgentCore Runtime**; simulated Alexa+ client
built with **Strands Agents SDK**. Both named by Amazon as what they're using.

**Open Source** — new OSS project shipped during the window. Needs: contribution URL,
repo URL, GitHub username, short description of what/how/why.
Second shot: any upstream PR to MCP SDK / Strands if we hit a real bug. Hacktoberfest
(Oct 1-31) overlaps the deadline.

## Admin

- [ ] Claim $150 AWS credits (form — all participants)
- [ ] Create builder.aws.com account (AgentCore + Strands workshops)
- [ ] Register on Devpost

## Judging criteria (what to optimize)

1. **Tech Implementation** — how well built, how effectively it uses MCP
2. **Design** — complete, coherent product experience; intuitive interaction model
3. **Potential Impact** — credible, specific customer need; audience beyond the hackathon
4. **Quality of the Idea** — creative use of the tools, genuine ecosystem understanding

Amazon's own framing: *"think of it as our MCP prize"* — judged on MCP quality and
**ideation**, not device integration. Simulator path is expected and fully legitimate;
they said "you cannot take an SDK and control an Echo Show" today.
