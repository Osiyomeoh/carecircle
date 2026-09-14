# CareCircle

**An MCP server that finds the work nobody has taken responsibility for.**

Every family coordination tool assumes someone already noticed the work. Someone
notices a ride is needed, creates a task, assigns it. That is exactly the step that
fails: the problem is almost never *"we had a task and ignored it"*. It is
*"nobody realised a ride was needed until Thursday morning."*

CareCircle starts one step earlier. Ordinary sentences become structured events,
events imply obligations, and obligations need an owner. The ones without an owner
are **Care Gaps**.

```
EVENTS          ->   OBLIGATIONS       ->   OWNERSHIP
what happened        what must happen        who has it
"cardiology          someone has to          ...nobody
 Thursday at 10"     drive her                has claimed it
```

---

## The interaction

**Margaret, 78, to her kitchen Echo** — she has never used a smartphone:

> "Alexa, I have cardiology Thursday at ten."

CareCircle records the appointment, then notices something and says so:

> "Will Mom need a ride to cardiology? **I'm guessing from the appointment type, not
> from anything anyone told me.**"

**David, her son, driving home two days later:**

> "Alexa, what's going to fall through the cracks this week?"

> "There are two things that need attention. Drive Mom to cardiology Thursday at 10 —
> nobody has taken this yet. And **there's no record of** Mom's evening heart pill."

> "I'll take the cardiology one."

> "Done — Drive Mom to cardiology is yours."

Nobody created a task. Nobody opened an app. Margaret, who cannot use one, is a
participant rather than a monitored subject.

---

## Known is not Assumed

The rule the whole system is built on:

> **The absence of a record is never treated as proof that something did not happen.**

CareCircle will say *"there's no record of her evening dose"*. It will never say
*"she missed her evening dose"*, because it does not know that. Every fact carries
provenance and the four states are never collapsed:

| State | Meaning |
|---|---|
| `CONFIRMED` | A human asserted it. The only thing treated as fact. |
| `NOT_LOGGED` | No record exists. Not evidence of anything. |
| `INFERRED` | The system guessed, by a named rule. Never counts until confirmed. |
| `RESOLVED` | An obligation was discharged. |

This is enforced by a test, not by good intentions:

```js
assert.doesNotMatch(gap.spoken, /did ?n[o']t take|missed|forgot|failed/i);
```

In a domain that runs on family guilt, a system that turns silence into an accusation
is worse than no system. So ours structurally cannot.

**Inference proposes, humans dispose.** Obligations the system infers enter as
`PROPOSED` and are excluded from Care Gaps entirely until a person confirms them.
The system is allowed to notice that an appointment probably needs a ride. It is not
allowed to decide that on the family's behalf.

---

## One record, four relationships

The household — not the individual — is the unit of state. The same server serves
everyone in the circle with different authority, and **identity comes from the
session credential, never from the conversation**: a model can be talked into
believing anything about who is speaking, and this server assigns responsibility for
someone's medical care.

| Member | Role | Can |
|---|---|---|
| Margaret, 78 | `care_recipient` | Log her own events; hear her own day |
| David | `primary_caregiver` | Everything: claim, assign, confirm, escalate |
| Renee | `caregiver` | Claim, add, confirm — but not assign to others |
| Tasha (paid aide) | `helper` | Only her shift, and only work she owns |

Denials are written to be spoken, and say what the person *can* do instead:

> "Only the primary caregiver can assign work to someone else. You can take it on
> yourself instead."

---

## About Alexa Together

Amazon has explored this space before. [Alexa Together](https://www.aboutamazon.com/news/devices/alexa-together-launches-to-help-customers-remotely-care-for-loved-ones)
launched in 2021 and was discontinued in May 2025. We deliberately did not rebuild it.

Alexa Together was a **monitoring** product: one caregiver watching one parent, sold
as a subscription Amazon had to operate, with the support and liability that implies.
CareCircle is a **coordination** product: several people sharing one record, with the
care recipient as a participant. It is an add-on, not a service Amazon runs.

That a company builds something twice — Care Hub in 2020, Alexa Together in 2021 —
says the customer need is real. What did not work was the shape. Add-ons are a shape
where the platform does not have to own the vertical in order to serve the customer.

---

## What this is not

Not a medication tracker. Not a family calendar. Not elder monitoring. Not reminders.
Those exist and are well served.

CareCircle does one thing: it finds responsibilities hidden inside everyday
conversation, surfaces the ones nobody owns, and lets a family resolve them by voice.

---

## Architecture

```
                    Alexa+ / any MCP host
                            |
                   MCP  (Streamable HTTP, spec 2025-11-25)
                            v
                +-----------------------+
                |   CareCircle server   |
                +-----------+-----------+
                            |
       +-------------+------+------+--------------+
       v             v             v              v
   Resources       Tools        Prompts      Elicitation
   care state    11 tools    daily check    confirm a
   timeline                  weekly review  proposal
       |             |
       +------+------+
              v
      Care Gap engine        <- deterministic. Not model narration.
      provenance, severity,     The model speaks the result;
      ranking, reasons          it does not invent it.
              v
      Append-only event store
```

**Care Gap detection is server logic, not a prompt.** The model receives ranked,
reasoned, structured gaps and speaks them. That keeps the reasoning auditable, makes
the ordering inspectable (every gap carries its `score` and a plain-language
`because`), and means the server is useful to any client — not only an LLM.

---

## Running it

```bash
npm install
npm run dev      # MCP server on :8787
npm run sim      # simulated Alexa+ experience on :5173
npm run e2e      # the whole story, through a real MCP client
npm test
```

The simulator and the evals need AWS credentials with Bedrock access:

```bash
export AWS_PROFILE=conductor
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

See `.env.example`. Bedrock daily token quotas are per region, so a second region
with model access enabled is a useful fallback when one is exhausted.

## Measured tool selection

An MCP server lives or dies on whether a model picks the right tool from the
descriptions alone, so we measure it rather than assert it:

```bash
npm run demo:reset && npm run dev   # in one shell
npm run evals                       # in another
```

68 utterances across all four members of the care circle. The model receives the
real tool definitions and one utterance; we record its first tool choice and
execute nothing. Cases that never reach the model — credentials, throttling — are
excluded from the accuracy figure rather than counted as wrong answers, because a
number that can lie is worse than no number.

Demo credentials (one per member — the identity model in miniature):

| Member | Token |
|---|---|
| Margaret | `margaret-token` |
| David | `david-token` |
| Renee | `renee-token` |
| Tasha | `aide-token` |

---

## The tools

Every tool exists because a person says a sentence that needs it.

| Tool | The sentence |
|---|---|
| `log_care_event` | "I took my heart pill" |
| `record_appointment` | "Cardiology is Thursday at ten" |
| `add_note` | "Mom sounded tired on the phone" |
| **`get_care_gaps`** | **"What's going to fall through the cracks this week?"** |
| `claim_obligation` | "I'll take it" |
| `assign_obligation` | "Give the pharmacy run to Renee" |
| `confirm_proposal` | "Yes, she'll need a ride" |
| `resolve_obligation` | "Picked up the prescription" |
| `get_shift_brief` | "What do I need to know today?" |
| `notify_member` | "Tell Renee I'm taking Mom Thursday" |

Tool design follows four rules, because the model is the user:

- **Descriptions disambiguate near-neighbours** — `log_care_event` vs
  `record_appointment` vs `add_note`; `claim` vs `assign`.
- **Errors instruct rather than report.** Two medications match "heart pill"? The tool
  returns *"ask which one they mean, then call this again"* — it never guesses.
- **Ambiguity is a question, not a default.**
- **Results are written to be spoken verbatim.** No markdown, no ids read aloud, and
  long lists are counted rather than recited.

---

## What Alexa+ MCP needs for this to be great

Product feedback, written while building. Full detail in
[`docs/FEATURE-REQUESTS.md`](docs/FEATURE-REQUESTS.md) and
[`docs/FRICTION-LOG.md`](docs/FRICTION-LOG.md).

1. **Rich cards.** Our core answer is a ranked list with state — severity, owner or
   the absence of one, due time, reason. Spoken, the usable ceiling is about three
   items. On a screen a family absorbs twelve and points at the one they mean. We
   compute all of it and discard it at the speech boundary.
2. **Actionable cards.** Voice is the right input for *capture* and the wrong input
   for *disambiguating among similar items*. A misheard referring expression assigning
   a hospital trip to the wrong person is not an acceptable failure.
3. **Confirmation as a surface.** Before Thursday's hospital run is assigned to Renee,
   Renee's name should be on screen.
4. **Multi-person identity.** Families are not single users. Speaker identity should be
   available — and explicitly unknown when it is not, rather than assumed.
5. **Ambient state.** The most valuable moment is not a conversation. It is someone
   walking past the kitchen Echo and noticing Thursday still has no driver.

---

## License

MIT. See [LICENSE](LICENSE).
