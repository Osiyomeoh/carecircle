# What makes it unique in the MCP lane

Amazon told us the Alexa+ prize is "the MCP prize," judged on ideation. So the honest
question is: **against the MCP servers actually being built, what is CareCircle doing
that they aren't?** Below is a set of criteria we hold ourselves to, the typical MCP
entry on each, and where we land - including where we are *not* special.

The rubric's own words frame the two ends: *obvious* is "a single-turn Q&A bot, a basic
MCP wrapper around an existing API"; *creative* is "agentic orchestration across
services, state across sessions, purchasing, media (cards)." We built for the second.

## The criteria

| # | Uniqueness criterion | The typical MCP entry | CareCircle |
|---|---|---|---|
| 1 | **State across sessions** | Stateless request→response; each call forgets the last | A persistent shared **care record** is the product; every tool reads and writes it |
| 2 | **Who is speaking** | Single user; identity is whatever the prompt claims | Session **bound to a member's credential**; 4 roles, different capabilities; the conversation can never assert identity |
| 3 | **Side effects** | Read-only lookups (data, weather, a Pokedex) | Writes, **ownership transitions**, and **in-place purchase** that closes a task |
| 4 | **Trust model** | Whatever the model says is treated as fact | **Known ≠ Assumed** - an inference or an absence can never masquerade as a confirmed fact; enforced in types and tests |
| 5 | **Proactivity** | Answers only what it's asked | Surfaces **what nobody owns** - the assistant as an *accountability layer*, not a lookup |
| 6 | **Multi-surface** | One app, one API behind it | One record fed by **voice + doorbell** today, with a documented adapter seam for more |
| 7 | **Measured quality** | "It works in the demo" | **~92-93% held-out tool-selection accuracy** (124-126/135 across runs) on Bedrock, published + reproducible |
| 8 | **Production reality** | A laptop demo | Deployed on App Runner, DynamoDB-backed, **82 tests + adversarial suite**, CI |

## The one-line differentiator

Most MCP servers answer **"what is X?"** CareCircle answers **"what needs to happen,
who owns it, and can I close it right now?"** - and it will not lie to do so.

## Where we are honestly *not* unique

- **The domain (elder care) is not novel** - many caregiving apps exist. Our novelty is
  the *interaction model* (gaps + ownership + trust), not the market.
- **Aggregating signals is a known idea** - the freshness is the *combination* with the
  trust model and the purchase close, not aggregation alone.
- **A simulated Alexa+ client is common** - Amazon expects it; ours competes on the card
  quality and the purchase moment, not on having a simulator.

Being clear-eyed about this is itself the point: we win the "quality of the idea"
criterion on the **synthesis** - criteria 1–5 together - not on any single trick.

## How to use this

- In the video: show criteria **3, 4, 5** on screen (purchase-in-place, "no record"
  not "she missed it", and the Care Gaps question). Those are the ones a judge remembers.
- In the writeup: lead with the one-line differentiator, then criterion 7 (the number)
  to prove it is built, not just pitched.
