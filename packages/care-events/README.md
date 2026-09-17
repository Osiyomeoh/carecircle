# @carecircle/care-events

**One adapter seam any device can plug into.**

Family and elder-care coordination fails at a specific seam: every tool assumes a
human already *noticed* the work and typed a task. The interesting signals never
arrive as tasks. They arrive as a spoken sentence, a wearable's summary of a
conversation, a doorbell that saw a delivery - three completely different shapes.

This tiny, zero-dependency package defines the **one contract** they all become, so a
coordination engine can treat them uniformly:

```
raw device payload ──(adapter)──► CareEvent ──► your engine
```

## The one rule that matters: evidence, never conclusion

A signal is **evidence**, not a fact. Every `CareEvent` carries a `Provenance` that
says how much to trust it, and the contract forbids an inference or an absence from
masquerading as a confirmed truth:

- `CONFIRMED` - a human asserted it. The only thing to treat as fact.
- `INFERRED` - a device or model guessed it, by a named rule. Confirm before acting.
- `NOT_LOGGED` - there is no record. **Not** the same as "it did not happen."

A Ring package delivery is not "the prescription was picked up" - it is `INFERRED`
evidence that *a package arrived*. A wearable's overheard sentence is not a fact -
it is `INFERRED` until a person confirms it. Adapters **classify; they never assert.**

## Why it's a pattern worth reusing

To the engine downstream, a Bee fact and a Ring doorbell are **the same kind of
thing**: another surface writing evidence into one record. That is the whole seam -
add a new device by writing one `SignalAdapter`, and nothing else changes.

```ts
import { ringAdapter, beeAdapter, careEvent, type SignalAdapter } from '@carecircle/care-events';

// A doorbell delivery becomes evidence toward an errand - never a conclusion.
const [delivery] = ringAdapter.adapt({ type: 'motion_detected', sub_type: 'package_delivery', request_id: 'r1' });
// delivery.kind === 'delivery', delivery.provenance.kind === 'INFERRED'

// A wearable fact is the *same shape*, indistinguishable downstream.
const [fact] = beeAdapter.adapt({ text: 'needs bloodwork before Thursday', confidence: 0.8 });

// Your own device: implement one adapter and you're in.
const alexa: SignalAdapter<{ said: string }> = {
  source: 'alexa',
  adapt: (raw) => [careEvent({ source: 'alexa', kind: 'medication', detail: raw.said,
    provenance: { kind: 'CONFIRMED', by: 'margaret', at: new Date().toISOString() } })],
};
```

## Included adapters

- **`ringAdapter`** - Ring webhook envelope → `CareEvent`, idempotent on `request_id`,
  unknown event types ignored rather than mismapped.
- **`beeAdapter`** - a Bee conversation fact → `CareEvent`, entering as `INFERRED`.

Bring your own transport and your own engine; this package is only the seam.

## Install / develop

```bash
npm install    # or add @carecircle/care-events to your project
npm test       # node:test, zero runtime dependencies
npm run build
```

## Where this comes from

Extracted from [CareCircle](../../README.md), an Alexa+ MCP server that turns care
signals into shared obligations and surfaces the ones nobody owns. This package is
the device-agnostic core of that idea, packaged so any project can adopt the pattern.

MIT licensed.
