# The demo video - shot list and script

**Hard limit 3:00.** Judging weights Technological Implementation, Design, Potential
Impact and Quality of the Idea **equally**, so the video must earn all four - it
cannot be three minutes of product tour.

**The spine is the delegation loop**, because it is the only part of this system that
does something no other assistant does: it finds work **nobody owns** and pursues it
until someone does.

**One rule for the whole video: never imply Ring or Bee is doing more than it is.**
The Ring event is driven by our signed simulator and is labelled as such on screen.
A judge who cross-checks the repo must find the video conservative, not generous.

---

## Before you record

- [ ] `npm run demo:reset` - the board must open in the exact state beat 2 assumes.
- [ ] Dismiss the two zombie `PROPOSED` rows dated 2024-12-19 (`confirm_proposal`,
      `confirmed:false`) or they appear on camera as a December-2024 appointment.
- [ ] Voice pace set to **gentle** in the console. Polly Ruth/generative.
- [ ] Two windows arranged in advance: console left, `/tv-native` right. Never
      alt-tab on camera.
- [ ] Burn in captions. The video makes an accessibility argument out loud; an
      uncaptioned video making that argument loses the point in front of the judge.

---

## 0:00-0:18 - The failure, stated as a fact about the world

> **VO:** "Margaret is 78 and lives alone. Her son, her daughter and a paid aide all
> help. Nobody is in charge. So the thing that fails isn't the task someone forgot -
> it's the task **nobody knew was theirs.**"

**On screen:** three phones, three half-conversations, one unanswered question:
*"wait, is someone driving her Thursday?"*

Cut hard on the word "theirs". No logo yet.

## 0:18-0:45 - Margaret logs her own care, by voice

**Live console.** Margaret speaks - the care recipient, not a caregiver:

> **Margaret:** "I took my heart pill this morning."
> **CareCircle:** *(Polly, gentle pace)* "Got it. Logged for this morning."

**On screen caption:** `CONFIRMED - she said it herself`

> **VO:** "The person being cared for is a participant, not a row on someone else's
> dashboard. She has never used a smartphone. She talks."

## 0:45-1:05 - The refusal (the single most important beat)

> **David:** "Did Mom take her evening pill?"
> **CareCircle:** "There's no record of the evening dose."

Freeze. Two cards side by side, held for a full three seconds:

| What a normal assistant says | What CareCircle says |
|---|---|
| "She missed it." | "There's no record." |

> **VO:** "It will not turn an absence of information into an accusation about
> someone's mother. We measured that: the same model, unguarded, makes that
> accusation in half of these cases. Ours, zero."

**On screen:** `npm run trust-benchmark - raw model 50% -> CareCircle 0%`

## 1:05-1:25 - Physical evidence, entering as evidence

Split screen. Right: the terminal running the **signed Ring simulator**.

`npm run ring:simulate -- --event package`

Left: the board. A new card appears: **"a package arrived"** with an amber
`INFERRED` chip - *not* "the prescription came".

**On screen, unmissable:** `Ring simulator - signed with the real partner HMAC key`

> **VO:** "A doorbell camera saw a delivery. That's evidence, not a conclusion. It
> enters as something a human confirms. No sensor in this system can ever close an
> obligation on its own - there's a test that enforces it."

## 1:25-2:05 - The delegation loop (the centrepiece - give it the time)

The board shows the cardiology appointment **and a ride nobody owns**, ranked HIGH.

Tap the score. It expands: `cost x p(dropped) x confidence`.

> **VO:** "Severity here is arithmetic, not a vibe. Expected harm - and an assumption
> can never outrank a fact."

> **David:** "Who can take Mom to cardiology Thursday the 24th?"
> **CareCircle:** "I picked Renee because she's the one who has the fewest things on
> this week. I've asked her."

**Caption:** `REQUESTED - asked is not agreed. Still a Care Gap.`

Renee declines. Without being asked again:

> **CareCircle:** "Renee can't. I've asked Tasha."

Tasha accepts. The gap clears on **both** screens at once.

> **VO:** "Being asked is not having agreed - so a pending request is still an open
> gap, and it climbs back to full risk within a day. Family is asked before the paid
> aide. That order is deterministic, and it's in the repo."

## 2:05-2:20 - Closing a gap by buying the fix

The refill gap. One card, confirmed in place, in the conversation.

> **VO:** "And where the fix is a purchase, it happens here. The gap closes the
> moment the order is placed."

## 2:20-2:45 - Why this matters, and who it excludes if you get it wrong

Cut to the television surface, across the room, a person glancing at it.

> **VO:** "Over 1.5 billion people live with hearing loss. Over 2.2 billion with
> vision impairment. Most of them are older - which means most of them are the people
> this is for. So no single channel is allowed to be load-bearing: the spoken answer
> is complete without the screen, and the screen is complete without the voice.
> That's not a setting. It's a test that fails the build."

**On screen:** `src/modality.test.ts - both directions asserted`

> **VO, over a map pulling to West Africa:** "And where I'm from, this isn't a
> convenience layer over a care system. Cameroon has fewer than fifty nursing-home
> places for twenty-eight million people. The family **is** the care system - one
> child in Lagos, one abroad, a parent in the village. Coordination isn't a feature
> of eldercare there. It's the whole of it."

## 2:45-3:00 - What it actually is

> **VO:** "CareCircle is an MCP server. Twenty-one tools, live now, spec 2025-11-25,
> OAuth 2.1 with PKCE so Alexa+ can link it to a real person. Two hundred and nine
> tests. Every number in this video is reproducible from the repo."

**On screen, held to black:**

```
Live:  https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp
Repo:  npm ci && npm run story     (no AWS, no keys)
```

---

## Cutting room floor (do NOT restore)

Each of these was considered and cut for a reason worth remembering:

- **An architecture diagram.** Three minutes buys one idea landed, not a system
  explained. The diagram lives in the repo, where a judge can pause on it.
- **The Fire TV APK.** Shown as the `/tv-native` surface instead - the point is the
  shared display, and the APK costs 15 seconds to prove and proves less.
- **The eval number (93.3%).** It is a tool-selection metric and inviting a judge to
  ask "what about the other 6.7%?" mid-video costs more than the number earns. It is
  in the writeup with the miss analysis.
- **Voice-accuracy tooling (Transcribe, the repair layer).** Real work, but it is
  infrastructure for the demo, not the argument.
