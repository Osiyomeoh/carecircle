import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { detectCareGaps, pendingProposals } from '../domain/gaps.js';
import { orphanedBy, proposeFromAppointment } from '../domain/inference.js';
import { candidatesFor } from '../domain/delegation.js';
import { runAgentOnce } from '../domain/agent-runner.js';
import { deliberate, AGENT_ID } from '../domain/agent.js';
import { implausible, toInstant } from '../domain/time.js';
import { interpretSignal, type CareSignal } from '../domain/signals.js';
import { offerFor, offerSpoken, formatPrice, type OfferKind, type PurchaseOffer } from '../domain/commerce.js';
import { can, canActOn, capabilitiesOf, NotPermittedError, require as requireCap } from '../domain/auth.js';
import { attributionOf, isReported, sayWhoSaysSo } from '../domain/attribution.js';
import { explainProvenance } from '../domain/provenance.js';
import { bootstrapSubject } from '../http/identity.js';
import { CareStore, HouseholdScopeError, NotFoundError } from '../store/store.js';
import { CARE_BOARD_HTML } from './app/care-board.js';
import { APP_MIME_TYPE, appToolMeta } from './app/protocol.js';
import { countPhrase, joinSpoken, sentence, speakGaps } from './text.js';
import type { Member } from '../domain/types.js';
import { RecordOnlyNotifier, type Notifier } from '../notify/notifier.js';

/**
 * The CareCircle MCP server.
 *
 * Two rules govern everything below.
 *
 * 1. Tools exist because a person says a sentence that needs them. There is no
 *    tool here that mirrors a database table for its own sake.
 * 2. Everything a tool returns is written to be *spoken*, and every error is
 *    written to tell the model what to do next. A failed call should move the
 *    conversation forward, not dead-end it.
 */

/** Where the Care Board view lives. Referenced by the tool that renders it. */
const CARE_BOARD_URI = 'ui://carecircle/care-board.html';

/** A tool result shaped for a voice client: one speakable line plus structure. */
function reply(spoken: string, structured?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: spoken }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * An error the model should act on rather than report.
 *
 * The text is phrased as guidance ("ask which one", "you can claim it yourself")
 * because the model is the audience - it is deciding what to do next, and a stack
 * trace tells it nothing useful.
 */
function guidance(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function describeError(err: unknown): string {
  if (err instanceof NotPermittedError) return err.message;
  if (err instanceof HouseholdScopeError) return err.message;
  if (err instanceof NotFoundError) {
    return `I couldn't find that ${err.what}. Ask the person which one they mean, or list what's open first.`;
  }
  return "Something went wrong saving that, so it hasn't been recorded. Tell the person it didn't save and offer to try again.";
}

export interface ServerContext {
  store: CareStore;
  /** Who is speaking. Established by the session credential, never by the conversation. */
  actorId: string;
  /** Injectable for deterministic tests and demos. */
  now?: () => Date;
  /** How a notify_member message is delivered. Defaults to record-only. */
  notifier?: Notifier;
}

/** A timezone the runtime can actually format in - the IANA name must be valid, or
 *  gap detection (which reads the household timezone) throws on every later call. */
function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Every entry must be a 24-hour "HH:MM"; a malformed time is silently un-checkable. */
function validMedicationTimes(times: string[]): boolean {
  return times.length > 0 && times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
}

export function createCareCircleServer(ctx: ServerContext): McpServer {
  const { store, actorId } = ctx;
  const now = ctx.now ?? (() => new Date());
  const notifier = ctx.notifier ?? new RecordOnlyNotifier();

  const server = new McpServer(
    { name: 'carecircle', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        'CareCircle tracks what needs to happen for someone being cared for, and who is '
        + 'responsible for it. Speak results as written - they are phrased for a voice '
        + 'assistant. Never say that someone did not take a medication or did not do '
        + 'something: the system only knows what has been recorded, and an absent record '
        + 'is not evidence. When a tool returns an error, follow the instruction in it.',
    },
  );

  const actor = (): Member => store.getMember(actorId);
  const household = () => actor().householdId;
  const state = () => store.getCareState(household());
  const nameOf = (id: string | null): string | undefined => {
    if (!id) return undefined;
    // The agent is a reporter in the log like anyone else, and must be nameable, or
    // its requests read as coming from nobody. It is not a member and holds no work.
    if (id === AGENT_ID) return 'CareCircle';
    try {
      const m = store.getMember(id);
      return m.spokenAs ?? m.name;
    } catch { return undefined; }
  };

  // --- 1. "I took my heart pill." ----------------------------------------
  server.registerTool('log_care_event', {
    title: 'Log something that happened',
    description:
      'Record that something happened - a medication taken, a meal eaten, a check-in, '
      + 'how someone is feeling. Use this for things that ALREADY happened. For something '
      + 'scheduled in the future use record_appointment instead; for an observation or '
      + 'concern with no action attached use add_note.',
    inputSchema: {
      kind: z.enum(['medication_taken', 'check_in'])
        .describe('What sort of event this is.'),
      medicationName: z.string().optional()
        .describe('For medication_taken: what they took, as they said it (e.g. "heart pill").'),
      detail: z.string().optional()
        .describe('Anything else they said about it, kept verbatim for the record.'),
      occurredAt: z.string().optional()
        .describe('ISO timestamp if they said when. Defaults to now if they did not.'),
      aboutMemberId: z.string().optional()
        .describe('Only when logging on behalf of someone else. Defaults to the speaker.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ kind, medicationName, detail, occurredAt, aboutMemberId }) => {
    try {
      const me = actor();
      const subject = aboutMemberId ?? me.id;
      requireCap(me, subject === me.id ? 'log_own_event' : 'log_others_event');

      const meds = store.getMedications(me.householdId);
      let medicationId: string | undefined;
      if (kind === 'medication_taken' && medicationName) {
        const needle = medicationName.toLowerCase();
        const matches = meds.filter((m) => m.name.toLowerCase().includes(needle)
          || needle.includes(m.name.toLowerCase()));
        if (matches.length > 1) {
          // Ambiguity is resolved by asking, never by picking the first match.
          return guidance(
            `More than one medication matches "${medicationName}": `
            + `${joinSpoken(matches.map((m) => m.name))}. Ask which one they mean, then call this again.`,
          );
        }
        medicationId = matches[0]?.id;
      }

      const event = await store.appendEvent({
        householdId: me.householdId,
        kind,
        reportedBy: me.id,
        occurredAt: occurredAt ?? now().toISOString(),
        ...(detail ? { detail } : {}),
        data: {
          ...(medicationId ? { medicationId } : {}),
          ...(medicationName ? { medicationName } : {}),
          aboutMemberId: subject,
        },
      });

      // A dose logged against a medication we don't know about is still recorded -
      // we just can't use it to clear a scheduled dose, and we say so.
      const unknownMed = kind === 'medication_taken' && medicationName && !medicationId;
      const spoken = kind === 'medication_taken'
        ? (unknownMed
          ? `Got it, I've noted the ${medicationName}. That one isn't on the schedule I have, so I can't match it to a dose.`
          : `Got it, I've logged the ${medicationName}.`)
        : "Thanks, I've noted that.";
      return reply(spoken, { eventId: event.id, matchedMedication: medicationId ?? null });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 2. "Cardiology is Thursday at ten." -------------------------------
  server.registerTool('record_appointment', {
    title: 'Record an appointment',
    description:
      'Record a scheduled appointment or any future dated commitment the person mentions '
      + '- a doctor\'s visit, a haircut, book club on Wednesday, a birthday. It does not '
      + 'have to be medical: use this, not add_note, whenever there is a date and time. '
      + 'It also works out what the appointment probably requires - only a MEDICAL one '
      + 'proposes a ride or a companion - and PROPOSES that work for a human to confirm. '
      + 'Proposals are guesses and are never treated as real until confirmed with '
      + 'confirm_proposal. Tell the person what was proposed and ask.',
    inputSchema: {
      kind: z.string().describe('What the appointment is, as said (e.g. "cardiology", "dentist").'),
      startsAt: z.string().describe(
        'ISO 8601 timestamp of when it starts, in the household\'s local time '
        + '(e.g. "2026-09-24T10:00:00"). Resolve "Thursday" against today\'s date - '
        + 'never guess a date, and ask which day they meant if it is not clear.',
      ),
      forMemberId: z.string().optional().describe('Who it is for. Defaults to the care recipient.'),
      detail: z.string().optional().describe('Anything else said about it.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ kind, startsAt, forMemberId, detail }) => {
    try {
      const me = actor();
      requireCap(me, 'create_obligation');
      const s = state();
      const recipient = forMemberId
        ? store.getMember(forMemberId)
        : s.members.find((m) => m.role === 'care_recipient');
      if (!recipient) {
        return guidance('I don\'t know who this appointment is for. Ask whose appointment it is.');
      }
      const subject = recipient.spokenAs ?? recipient.name;

      // "Thursday at ten" reaches us as a timestamp a language model invented, and
      // a model does not reliably know today's date. Two guards before this becomes
      // an appointment somebody relies on.
      const at = toInstant(startsAt, s.household.timezone);
      if (!at) {
        return guidance(
          `I couldn't make sense of "${startsAt}" as a date and time. `
          + 'Ask them which day and time they meant.',
        );
      }
      const doubtful = implausible(at, now());
      if (doubtful) return guidance(doubtful.spoken);

      const event = await store.appendEvent({
        householdId: me.householdId,
        kind: 'appointment_scheduled',
        reportedBy: me.id,
        occurredAt: at,
        ...(detail ? { detail } : {}),
        data: { appointmentKind: kind, forMemberId: recipient.id },
      });

      const seeds = proposeFromAppointment(kind, subject, at);
      const proposed = await Promise.all(seeds.map((seed) => store.createObligation({
        householdId: me.householdId,
        what: seed.what,
        status: 'PROPOSED',
        consequence: seed.consequence,
        provenance: seed.provenance,
        ownerId: null,
        ...(seed.dueAt ? { dueAt: seed.dueAt } : {}),
        sourceEventId: event.id,
      })));

      const spoken = proposed.length === 0
        ? `Noted - ${kind} for ${subject}.`
        : `Noted - ${kind} for ${subject}. ${seeds[0]!.ask}`;
      return reply(spoken, {
        eventId: event.id,
        proposals: proposed.map((o, i) => ({ id: o.id, what: o.what, ask: seeds[i]!.ask })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 3. "Mom sounded tired on the phone." ------------------------------
  server.registerTool('add_note', {
    title: 'Add a note to the care record',
    description:
      'Record an observation, concern, or piece of context that the rest of the family '
      + 'should see - "Mom sounded tired", "the doctor changed her dose". Use this when '
      + 'there is something to SAY but nothing specific that must be DONE. If someone needs '
      + 'to take an action, use record_appointment or let the note stand and let them claim it.\n\n'
      + 'IMPORTANT: if the person says they (or someone) will be UNAVAILABLE - "I can\'t drive '
      + 'Thursday", "I won\'t be able to make Friday after all", "Renee is away next week" - '
      + 'this is still an add_note, with `unavailable` filled in. It is never "nothing to do": '
      + 'work that person was covering may quietly stop being covered, and that silence is '
      + 'exactly what this system exists to catch.',
    inputSchema: {
      note: z.string().describe('The observation, in the words it was said.'),
      aboutMemberId: z.string().optional().describe('Who it concerns. Defaults to the care recipient.'),
      unavailable: z.object({
        memberName: z.string().describe('Who is unavailable, as the speaker named them.'),
        from: z.string().describe('ISO start of the window they cannot cover.'),
        to: z.string().describe('ISO end of the window.'),
      }).optional().describe('Set when the note says someone cannot do something in a time window.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ note, aboutMemberId, unavailable }) => {
    try {
      const me = actor();
      const s = state();
      const about = aboutMemberId ?? s.members.find((m) => m.role === 'care_recipient')?.id;
      const event = await store.appendEvent({
        householdId: me.householdId,
        kind: 'note_added',
        reportedBy: me.id,
        occurredAt: now().toISOString(),
        detail: note,
        data: { aboutMemberId: about, ...(unavailable ? { unavailable } : {}) },
      });

      if (!unavailable) {
        return reply("I've added that to the care record.", { eventId: event.id });
      }

      // A constraint does not create work - it can orphan work that already has an
      // owner. Nobody says "create a task"; somebody says they can't make Thursday.
      const person = store.findMemberByName(me.householdId, unavailable.memberName);
      if (!person) {
        return reply("I've added that to the care record.", { eventId: event.id });
      }
      const orphaned = orphanedBy(
        { memberId: person.id, from: unavailable.from, to: unavailable.to, said: note },
        s.obligations,
        (id) => nameOf(id) ?? 'They',
      );
      if (orphaned.length === 0) {
        return reply("Noted - I'll keep that in mind.", { eventId: event.id, orphaned: [] });
      }

      // Reopen the orphaned work rather than silently reassigning it: CareCircle
      // notices, and asks. It never moves someone else's responsibility on its own.
      for (const o of orphaned) {
        await store.transition(o.obligationId, me.householdId, 'OPEN', me.id, { ownerId: null },
          `Owner unavailable: ${note}`);
      }
      return reply(orphaned[0]!.ask, {
        eventId: event.id,
        orphaned: orphaned.map((o) => ({ obligationId: o.obligationId, what: o.what })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 4. "What's going to fall through the cracks this week?" -----------
  server.registerTool('get_care_gaps', {
    title: 'Find what nobody has taken responsibility for',
    description:
      'THE core tool. Returns everything that needs attention and has no owner - unclaimed '
      + 'work, expected records that are missing, and things past their due time. Use this '
      + 'for "what needs doing", "what\'s unassigned", "what might fall through the cracks", '
      + 'or "is anything being missed". Also use it to resolve an implicit reference: when '
      + 'someone says "yes", "that one", "I\'ve got it" or "that\'s done" and you need to know '
      + 'which item they mean, call this to find it, then act. Results are already ranked by '
      + 'urgency and already phrased for speech: read them as written. Never restate a missing '
      + 'record as someone having failed to do something. The result also carries '
      + '`recordedToday` - what HAS been logged today, and who logged it. Check it before '
      + 'saying anything about what has or has not been taken: a gap for one dose never '
      + 'means nothing was taken, and a dose somebody else logged is still a record.',
    inputSchema: {
      withinDays: z.number().int().positive().max(365).optional()
        .describe('Only include dated items within this many days. Omit for everything.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    // On a host that can draw, this same call also renders the Care Board (see
    // ./app/care-board.ts). The spoken answer is unchanged and still correct on
    // its own: the view is an enhancement, never a precondition.
    _meta: appToolMeta(CARE_BOARD_URI),
  }, async ({ withinDays }) => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const gaps = detectCareGaps(state(), {
        now: now(),
        ...(withinDays !== undefined ? { withinDays } : {}),
      });
      // What IS on the record today, alongside what is missing from it.
      //
      // This tool could see absence and not presence, and a caller reading only
      // gaps will generalise "no record of the 08:00 dose" into "nothing has been
      // taken today" - which erases a record a real person made. We watched that
      // happen live, to a dose the aide had just logged. Absence is only half the
      // record and a tool that hands over half a record invites the other half to
      // be invented.
      const today = now().toISOString().slice(0, 10);
      const recordedToday = state().events
        .filter((e) => e.kind === 'medication_taken' && e.occurredAt.slice(0, 10) === today)
        .map((e) => ({
          what: e.data['medicationName'] ?? 'medication',
          at: e.occurredAt,
          attribution: attributionOf(e),
          saidBy: nameOf(e.reportedBy) ?? null,
        }));

      return reply(speakGaps(gaps), {
        recordedToday,
        gaps: gaps.map((g) => ({
          id: g.id, kind: g.kind, severity: g.severity, spoken: g.spoken,
          because: g.because, obligationId: g.obligationId ?? null, score: g.score,
          // The score's derivation travels with it so the view can show *why* a
          // gap ranks where it does. A ranking over someone's medical care that
          // cannot be audited should not be trusted.
          factors: g.factors,
        })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 5. "I'll take that one." ------------------------------------------
  server.registerTool('claim_obligation', {
    title: 'Take responsibility for something',
    description:
      'The speaker takes on a piece of work themselves ("I\'ll do it", "I\'ve got Thursday", '
      + '"I can take that one", "leave it with me"). To give work to someone ELSE, use '
      + 'assign_obligation instead. If you are unsure which item they mean - "that one", "it" '
      + '- call get_care_gaps to find it, then claim it, rather than doing nothing.',
    inputSchema: { obligationId: z.string().describe('Which piece of work. From get_care_gaps.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId }) => {
    try {
      const me = actor();
      requireCap(me, 'claim_obligation');
      const o = store.getObligation(obligationId, me.householdId);
      if (o.status === 'PROPOSED') {
        return guidance(
          `"${o.what}" hasn't been confirmed as actually needed yet. Ask them to confirm it `
          + 'first with confirm_proposal, then claim it.',
        );
      }
      if (o.ownerId && o.ownerId !== me.id) {
        return guidance(
          `${nameOf(o.ownerId)} already has "${o.what}". Ask whether they want to take it over.`,
        );
      }
      const updated = await store.transition(obligationId, me.householdId, 'ASSIGNED', me.id, { ownerId: me.id });
      return reply(`Done - ${o.what} is yours.`, { obligationId: updated.id, ownerId: me.id });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 6. "Give the pharmacy run to Renee." ------------------------------
  server.registerTool('assign_obligation', {
    title: 'Give a piece of work to someone',
    description:
      'Assign work to another member of the care circle. Only the primary caregiver can do '
      + 'this. When the speaker is taking it on themselves, use claim_obligation instead.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work. From get_care_gaps.'),
      assigneeName: z.string().describe('Who to give it to, as the speaker named them.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId, assigneeName }) => {
    try {
      const me = actor();
      requireCap(me, 'assign_obligation');
      const o = store.getObligation(obligationId, me.householdId);
      const assignee = store.findMemberByName(me.householdId, assigneeName);
      if (!assignee) {
        const others = state().members.filter((m) => m.id !== me.id).map((m) => m.spokenAs ?? m.name);
        return guidance(
          `There's nobody called "${assigneeName}" in this care circle. `
          + `The people here are ${joinSpoken(others)}. Ask which one they meant.`,
        );
      }
      const updated = await store.transition(
        obligationId, me.householdId, 'ASSIGNED', me.id, { ownerId: assignee.id },
      );
      const who = assignee.spokenAs ?? assignee.name;
      return reply(`Done - ${o.what} is assigned to ${who}.`, {
        obligationId: updated.id, ownerId: assignee.id,
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 6b. "Ask David if he can take her." -------------------------------
  //
  // The delegation loop. This is the difference between a system that *reports*
  // a Care Gap and one that *pursues* it. Asking deliberately does not move
  // ownership: the obligation goes to REQUESTED, ownerId stays null, and it keeps
  // showing up as a gap until a human actually says yes.
  server.registerTool('request_owner', {
    title: 'Ask someone to take a piece of work on',
    description:
      'Ask a member of the care circle whether they will take something on - "ask David if '
      + 'he can drive her", "see if Renee can pick up the prescription", "can someone take '
      + 'Thursday?", "who can do this?". This ASKS; it does not assign. They still have to '
      + 'say yes, and the work stays unowned until they do. If no name is given, leave '
      + 'assigneeName empty and this picks who to ask and explains why. Use assign_obligation '
      + 'only when the primary caregiver is putting it on someone\'s name outright, and '
      + 'claim_obligation when the speaker is taking it themselves.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work. From get_care_gaps.'),
      assigneeName: z.string().optional()
        .describe('Who to ask, as the speaker named them. Omit to let CareCircle suggest someone.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId, assigneeName }) => {
    try {
      const me = actor();
      requireCap(me, 'request_owner');
      const s = state();
      const o = store.getObligation(obligationId, me.householdId);
      if (o.status === 'PROPOSED') {
        return guidance(
          `"${o.what}" hasn't been confirmed as actually needed yet. Confirm it first with `
          + 'confirm_proposal, then ask someone to take it.',
        );
      }
      if (o.status === 'ASSIGNED' && o.ownerId) {
        return guidance(
          `${nameOf(o.ownerId)} already has "${o.what}". Ask whether they want to hand it over.`,
        );
      }

      const ranked = candidatesFor(o, s, { askerId: me.id });
      let target = ranked[0];
      if (assigneeName) {
        const named = store.findMemberByName(me.householdId, assigneeName);
        if (!named) {
          const others = s.members.filter((m) => m.id !== me.id).map((m) => m.spokenAs ?? m.name);
          return guidance(
            `There's nobody called "${assigneeName}" in this care circle. `
            + `The people here are ${joinSpoken(others)}. Ask which one they meant.`,
          );
        }
        if ((o.declinedBy ?? []).includes(named.id)) {
          const next = ranked[0];
          return guidance(
            `${named.spokenAs ?? named.name} has already said no to "${o.what}". `
            + (next
              ? `${next.name} ${next.because} - shall I ask them instead?`
              : 'There is nobody else left to ask. It may need the primary caregiver.'),
          );
        }
        target = {
          memberId: named.id,
          name: named.spokenAs ?? named.name,
          because: '',
          load: 0,
        };
      }

      if (!target) {
        return guidance(
          `There's nobody left to ask about "${o.what}" - everyone has either declined or `
          + 'said they are not available then. This may need the primary caregiver to step in.',
        );
      }

      const updated = await store.transition(
        obligationId, me.householdId, 'REQUESTED', me.id,
        { ownerId: null, request: { askedOfId: target.memberId, askedById: me.id, askedAt: now().toISOString() } },
        `Asked ${target.name}`,
      );
      const delivery = await notifier.deliver({
        to: target.memberId, toName: target.name, from: me.spokenAs ?? me.name,
        message: `${me.spokenAs ?? me.name} asked: can you take "${o.what}"?`,
      });
      await store.appendEvent({
        householdId: me.householdId,
        kind: 'owner_requested',
        reportedBy: me.id,
        occurredAt: now().toISOString(),
        detail: o.what,
        data: { obligationId, askedOfId: target.memberId, delivered: delivery.delivered },
      });

      // Say what is true: they were asked, and nobody owns it yet.
      const suggested = !assigneeName && target.because
        ? ` I picked ${target.name} because they're the one who ${target.because}.` : '';
      return reply(
        `I've asked ${target.name} whether they can take ${o.what}.${suggested} `
        + "It stays unowned until they say yes.",
        { obligationId: updated.id, askedOfId: target.memberId, status: 'REQUESTED' },
      );
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 6c. "Yes, I'll do it." / "No, I can't." ---------------------------
  server.registerTool('respond_to_request', {
    title: 'Answer a request to take something on',
    description:
      'The speaker answers something they were asked to take on - "yes, I\'ll do it", '
      + '"I can take that", "no, I can\'t", "sorry, not this week". Accepting makes them the '
      + 'owner. Declining puts it back with no owner, records that they said no, and suggests '
      + 'who to ask next - a decline is an answer, not a failure.',
    inputSchema: {
      obligationId: z.string().describe('Which request they are answering.'),
      accepted: z.boolean().describe('True if they said yes, false if they said no.'),
      note: z.string().optional().describe('Anything they said about why, in their words.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId, accepted, note }) => {
    try {
      const me = actor();
      const o = store.getObligation(obligationId, me.householdId);
      if (o.status !== 'REQUESTED' || !o.request) {
        return guidance(
          `Nobody has an outstanding request for "${o.what}". `
          + 'If the speaker wants it, they can take it on with claim_obligation.',
        );
      }
      // Only the person asked can answer. Anyone else "accepting" on their behalf
      // would be the system inventing an agreement that was never given.
      if (o.request.askedOfId !== me.id) {
        return guidance(
          `That was asked of ${nameOf(o.request.askedOfId)}, so it's theirs to answer. `
          + 'The speaker can take it on themselves instead if they want it.',
        );
      }

      if (accepted) {
        await store.transition(
          obligationId, me.householdId, 'ASSIGNED', me.id,
          { ownerId: me.id, clearRequest: true }, note,
        );
        await store.appendEvent({
          householdId: me.householdId, kind: 'request_answered', reportedBy: me.id,
          occurredAt: now().toISOString(), ...(note ? { detail: note } : {}),
          data: { obligationId, accepted: true },
        });
        return reply(`Thanks - ${o.what} is yours now.`, {
          obligationId, ownerId: me.id, status: 'ASSIGNED',
        });
      }

      const declinedBy = [...(o.declinedBy ?? []), me.id];
      await store.transition(
        obligationId, me.householdId, 'OPEN', me.id,
        { ownerId: null, clearRequest: true, declinedBy }, note,
      );
      await store.appendEvent({
        householdId: me.householdId, kind: 'request_answered', reportedBy: me.id,
        occurredAt: now().toISOString(), ...(note ? { detail: note } : {}),
        data: { obligationId, accepted: false },
      });
      // A decline should move the loop forward, not dead-end it.
      const next = candidatesFor(
        { ...o, declinedBy, ownerId: null }, state(), { askerId: me.id },
      )[0];
      return reply(
        `That's noted - ${o.what} is back with no owner. `
        + (next
          ? `${next.name} ${next.because}. Shall I ask them?`
          : 'There is nobody else left to ask, so the primary caregiver may need to step in.'),
        { obligationId, status: 'OPEN', declined: true, nextCandidate: next?.name ?? null },
      );
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 6d. "What have I been asked to do?" -------------------------------
  server.registerTool('get_my_requests', {
    title: 'What the speaker has been asked to take on',
    description:
      'Everything the speaker has been asked to take on and has not answered yet - "what do '
      + 'I have for Mom?", "did anyone ask me to do anything?", "what am I down for?", "what '
      + 'was I asked?". Read-only. Use this before respond_to_request when you do not know '
      + 'which request they mean.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => {
    try {
      const me = actor();
      requireCap(me, 'read_shift');
      const mine = state().obligations.filter(
        (o) => o.status === 'REQUESTED' && o.request?.askedOfId === me.id,
      );
      if (mine.length === 0) {
        return reply('Nobody is waiting on an answer from you right now.', { requests: [] });
      }
      const lines = mine.map((o) => {
        const who = nameOf(o.request!.askedById) ?? 'Someone';
        return `${who} asked you to take ${o.what}`;
      });
      return reply(
        `${joinSpoken(lines)}. You haven't answered yet.`,
        {
          requests: mine.map((o) => ({
            obligationId: o.id, what: o.what,
            askedBy: nameOf(o.request!.askedById) ?? null,
            askedAt: o.request!.askedAt,
            dueAt: o.dueAt ?? null,
          })),
        },
      );
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 6b. "How do we know that?" ----------------------------------------
  server.registerTool('get_provenance', {
    title: 'Explain how the system knows something',
    description:
      'Explains the whole chain behind one piece of work - "how do you know that?", "why '
      + 'are you saying this?", "where did that come from?", "who said she needs a ride?". '
      + 'Walks what was actually recorded: how the obligation arose (a human confirmed it, '
      + 'the system guessed it, or there is simply no record), the signal or event it came '
      + 'from, and every ownership move since. Read-only. Use it whenever someone questions a '
      + 'gap or a claim. Speak the result verbatim - it is phrased to state a guess as a guess '
      + 'and an absent record as an absent record, and it never accuses anyone.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work to explain. From get_care_gaps.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId }) => {
    try {
      const me = actor();
      requireCap(me, 'read_shift');
      const o = store.getObligation(obligationId, me.householdId);
      const explanation = explainProvenance(
        o, store.getTransitions(obligationId), state().events, nameOf,
      );
      return reply(explanation.spoken, {
        obligationId: explanation.obligationId,
        what: explanation.what,
        owner: explanation.owner,
        chain: explanation.chain,
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 7. "Yes, she'll need a ride." -------------------------------------
  server.registerTool('confirm_proposal', {
    title: 'Confirm or dismiss something the system guessed',
    description:
      'The system infers work from appointments (a ride to cardiology, someone to take notes) '
      + 'but never treats a guess as real. This turns a guess into actual work, or dismisses '
      + 'it. A short affirmation of a suggested need - "yes", "that\'s right", "she will need '
      + 'that", "someone should drive her" - is a confirmation: call this. If you do not know '
      + 'which proposal they mean, call get_care_gaps first to find it, then confirm. Always '
      + 'ask a person before calling this - the confirmation must come from them, not from '
      + 'your own judgement about what seems sensible.',
    inputSchema: {
      obligationId: z.string().describe('The proposal being answered.'),
      confirmed: z.boolean().describe('True if the person said it is needed, false if not.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId, confirmed }) => {
    try {
      const me = actor();
      requireCap(me, 'confirm_proposal');
      const o = store.getObligation(obligationId, me.householdId);
      if (o.status !== 'PROPOSED') {
        return guidance(`"${o.what}" has already been settled - it's ${o.status.toLowerCase()}.`);
      }
      await store.transition(obligationId, me.householdId, confirmed ? 'OPEN' : 'DISMISSED', me.id);
      return reply(
        confirmed
          ? `Right - ${o.what}. Nobody's taken it yet. Do you want it?`
          : `Okay, I'll leave that out.`,
        { obligationId, status: confirmed ? 'OPEN' : 'DISMISSED' },
      );
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 8. "Picked up the prescription." ----------------------------------
  server.registerTool('resolve_obligation', {
    title: 'Mark something as done',
    description:
      'Record that a piece of work has been completed. Use this when someone says a task '
      + 'is handled - "that\'s sorted now", "taken care of", "I dropped it off", "done". If '
      + 'they do not name which task, call get_care_gaps first to find which one they mean, '
      + 'then resolve it.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work.'),
      note: z.string().optional().describe('Anything they said about how it went.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ obligationId, note }) => {
    try {
      const me = actor();
      requireCap(me, 'resolve_obligation');
      const o = store.getObligation(obligationId, me.householdId);
      if (!canActOn(me, o)) {
        return guidance(`That one isn't assigned to you, so you can't close it out.`);
      }
      await store.transition(obligationId, me.householdId, 'RESOLVED', me.id, {
        resolvedAt: now().toISOString(), ...(note ? { resolutionNote: note } : {}),
      });
      await store.appendEvent({
        householdId: me.householdId, kind: 'obligation_resolved', reportedBy: me.id,
        occurredAt: now().toISOString(), ...(note ? { detail: note } : {}),
        data: { obligationId },
      });
      return reply(`Marked done - ${o.what}.`, { obligationId });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- The agent, on demand ---------------------------------------------
  // The agent normally runs on a timer with nobody watching. This lets a person
  // ask it to look right now - "is anything falling through the cracks?" - and,
  // because it runs the identical policy, also lets the autonomy be shown on camera
  // without waiting an hour for the clock. It asks; it never assigns; and it reports
  // its own restraint, so a pass that decides to do nothing still explains why.
  server.registerTool('run_care_agent', {
    title: 'Let CareCircle look for slipping work itself',
    description:
      'Have CareCircle proactively review everything unowned and, where it is worth '
      + 'interrupting somebody, ASK the fairest person to take it on - the same thing it '
      + 'does on its own in the background. Use this for "check on things", "is anything '
      + 'being missed", "chase up the open items", or to see what the agent would do. It '
      + 'only ever asks; it never assigns work to anyone. It reports both what it did and '
      + 'what it deliberately left alone, and why.',
    inputSchema: {
      dryRun: z.boolean().optional()
        .describe('When true, report what it would do without asking anyone. Defaults to false.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ dryRun }) => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const s = state();

      if (dryRun) {
        const d = deliberate(s, { now: now(), timezone: s.household.timezone });
        const lines = d.actions.map((a) => a.because);
        const held = d.restraint.map((r) => r.because);
        const spoken = d.actions.length
          ? `I would reach out about ${d.actions.length === 1 ? 'one thing' : `${d.actions.length} things`}. ${lines.join(' ')}`
          : "I looked, and there's nothing I'd interrupt anyone about right now.";
        return reply(spoken, { would: d.actions, heldBack: d.restraint, dryRun: true });
      }

      const run = await runAgentOnce(me.householdId, { store, notifier, now });
      const asks = run.performed.map((p) => p.action.because);
      const held = run.deliberation.restraint;
      const spoken = run.performed.length
        ? `Done. ${run.performed.length === 1 ? 'I reached out about one thing.' : `I reached out about ${run.performed.length} things.`} ${asks.join(' ')}`
        : (held.length
          ? `I looked at everything and decided to leave it for now. ${held[0]!.because}`
          : "I looked, and everything that needs doing already has someone.");
      return reply(spoken, {
        asked: run.performed.map((p) => ({ because: p.action.because, value: p.action.value, delivered: p.delivered })),
        heldBack: held,
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 9. "How's Mom doing today?" ---------------------------------------
  server.registerTool('get_care_summary', {
    title: "How is the person being cared for doing",
    description:
      'A picture of the day: what has been logged, what notes the family added, what is '
      + 'coming up, and anything unowned. Use for "how is she doing", "what happened today", '
      + '"catch me up". For unowned work specifically, get_care_gaps is sharper.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async () => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const s = state();
      const today = now().toISOString().slice(0, 10);
      const todays = s.events.filter((e) => e.occurredAt.slice(0, 10) === today);
      const meds = todays.filter((e) => e.kind === 'medication_taken');
      const notes = todays.filter((e) => e.kind === 'note_added');
      const gaps = detectCareGaps(s, { now: now() });
      const proposals = pendingProposals(s);

      const parts: string[] = [];
      // Who logged a dose is part of what the record says, not metadata about it.
      // A bare count silently upgrades "the aide says you took it" into "you took
      // it", which is the accusation rule failing in the opposite direction.
      const proxied = meds.filter(isReported);
      parts.push(meds.length > 0
        ? sentence(`${countPhrase(meds.length, 'medication')} logged today.`)
        : 'Nothing logged for medications today yet.');
      for (const e of proxied.slice(0, 2)) {
        parts.push(sentence(`${sayWhoSaysSo(attributionOf(e), (id) => nameOf(id) ?? null)}.`));
      }
      for (const n of notes.slice(0, 2)) {
        parts.push(`${nameOf(n.reportedBy) ?? 'Someone'} noted: ${n.detail}`);
      }
      if (gaps.length > 0) parts.push(speakGaps(gaps));
      if (proposals.length > 0) {
        parts.push(`There ${proposals.length === 1 ? 'is' : 'are'} also ${countPhrase(proposals.length, 'thing')} I'm not sure about yet.`);
      }
      return reply(parts.join(' '), {
        medicationsLogged: meds.length,
        medications: meds.map((e) => ({
          eventId: e.id,
          medicationId: e.data['medicationId'] ?? null,
          at: e.occurredAt,
          attribution: attributionOf(e),
        })),
        notes: notes.map((n) => ({ by: nameOf(n.reportedBy), text: n.detail })),
        gaps: gaps.map((g) => ({ severity: g.severity, spoken: g.spoken })),
        pendingProposals: proposals.map((p) => ({ id: p.id, what: p.what })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 10. "What do I need to know today?" (the paid aide) ---------------
  server.registerTool('get_shift_brief', {
    title: 'What this shift needs to know',
    description:
      'A short handoff brief for whoever is on duty: what is due, what they own, and any '
      + 'recent notes that change how today should go. Use it when a helper or aide asks '
      + 'what they need to know, what is happening today, or what medications the person is '
      + 'on today - for the aide this is how they see the day. Scoped deliberately - it does '
      + 'not expose the whole family record.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async () => {
    try {
      const me = actor();
      requireCap(me, 'read_shift');
      const s = state();
      const mine = s.obligations.filter((o) => o.ownerId === me.id && o.status === 'ASSIGNED');
      const meds = s.medications.map((m) => `${m.name} at ${joinSpoken(m.times)}`);
      const recentNote = [...s.events].reverse().find((e) => e.kind === 'note_added');

      const parts: string[] = [];
      parts.push(meds.length > 0 ? `Medications today: ${joinSpoken(meds)}.` : 'No medications scheduled.');
      parts.push(mine.length > 0
        ? `You have ${countPhrase(mine.length, 'thing')}: ${joinSpoken(mine.map((o) => o.what))}.`
        : 'Nothing is assigned to you right now.');
      if (recentNote?.detail) parts.push(`Latest note: ${recentNote.detail}`);
      return reply(parts.join(' '), {
        medications: s.medications.map((m) => ({ name: m.name, times: m.times })),
        assignedToMe: mine.map((o) => ({ id: o.id, what: o.what, dueAt: o.dueAt ?? null })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 11. "Tell Renee I'm taking Mom." ----------------------------------
  server.registerTool('notify_member', {
    title: 'Let someone in the care circle know something',
    description:
      'Send a short message to another member of the care circle - "tell Renee I\'m '
      + 'taking Mom Thursday", "let David know the pharmacy called", "message Renee about '
      + 'the appointment change", "text Renee". Any of tell / message / text / let-know a '
      + 'named person maps here. Use this when the speaker wants a specific PERSON told '
      + 'something. To record something for the whole family to see later, use add_note.',
    inputSchema: {
      recipientName: z.string().describe('Who to tell, as the speaker named them.'),
      message: z.string().describe('What to tell them, in the speaker\'s own words.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ recipientName, message }) => {
    try {
      const me = actor();
      const recipient = store.findMemberByName(me.householdId, recipientName);
      if (!recipient) {
        const others = state().members.filter((m) => m.id !== me.id).map((m) => m.spokenAs ?? m.name);
        return guidance(
          `There's nobody called "${recipientName}" in this care circle. `
          + `The people here are ${joinSpoken(others)}. Ask which one they meant.`,
        );
      }
      const who = recipient.spokenAs ?? recipient.name;
      const delivery = await notifier.deliver({
        to: recipient.id, toName: who, from: me.spokenAs ?? me.name, message,
      });
      const event = await store.appendEvent({
        householdId: me.householdId,
        kind: 'member_notified',
        reportedBy: me.id,
        occurredAt: now().toISOString(),
        detail: message,
        data: { recipientId: recipient.id, delivered: delivery.delivered, channel: delivery.channel },
      });
      // Stay honest about what happened. If a real channel pushed it, say so; if we
      // only recorded it, do not imply a phone buzzed.
      const spoken = delivery.delivered
        ? `I've sent that to ${who}.`
        : `I've noted that for ${who} - they'll see it on the care record.`;
      return reply(spoken, {
        eventId: event.id, recipientId: recipient.id,
        delivered: delivery.delivered, channel: delivery.channel,
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 12. A physical-world signal from a device (e.g. Ring) -------------
  server.registerTool('ingest_signal', {
    title: 'Record something a device observed',
    description:
      'Take an observation from a device in the home - a Ring doorbell, a camera, a '
      + 'sensor - and fold it into the care record. Use this for physical-world events '
      + 'nobody typed: a delivery arriving at the door, activity or the absence of it. '
      + 'A signal is EVIDENCE, not a conclusion: a delivery is grounds to ASK whether the '
      + 'prescription was picked up, not to mark it done; no activity is grounds to ASK '
      + 'whether someone should check in, never a claim that something is wrong.',
    inputSchema: {
      source: z.enum(['ring', 'other']).describe('Which device reported it.'),
      kind: z.enum(['delivery_arrived', 'door_activity', 'motion', 'no_activity'])
        .describe('What was observed.'),
      occurredAt: z.string().optional().describe('ISO time observed. Defaults to now.'),
      detail: z.string().optional().describe('Anything the device reported, kept verbatim.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ source, kind, occurredAt, detail }) => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const s = state();
      const recipient = s.members.find((m) => m.role === 'care_recipient');
      if (!recipient) return guidance("I don't know who this home belongs to.");

      const signal: CareSignal = {
        source, kind, at: occurredAt ?? now().toISOString(),
        ...(detail ? { detail } : {}),
      };
      const outcome = interpretSignal(signal, {
        recipientId: recipient.id,
        recipientName: recipient.spokenAs ?? recipient.name,
        now: now(),
      });

      const event = await store.appendEvent({ ...outcome.event, householdId: me.householdId });

      // If the signal is evidence toward open work, name the match so the model can
      // ask about the specific item - it does not resolve anything itself.
      let candidate: string | null = null;
      if (outcome.resolvesObligationLike) {
        const needle = outcome.resolvesObligationLike.match.toLowerCase();
        const open = s.obligations.find(
          (o) => o.what.toLowerCase().includes(needle) && o.status !== 'RESOLVED' && o.status !== 'DISMISSED',
        );
        candidate = open?.id ?? null;
      }

      // A proposed obligation (e.g. check-in) enters as a proposal, like any inference.
      let proposalId: string | null = null;
      if (outcome.proposeObligation) {
        const created = await store.createObligation({
          householdId: me.householdId,
          what: outcome.proposeObligation.what,
          status: 'PROPOSED',
          consequence: outcome.proposeObligation.consequence,
          provenance: { kind: 'INFERRED', rule: `signal:${source}:${kind}`, from: `${source} ${kind}` },
          ownerId: null,
          sourceEventId: event.id,
        });
        proposalId = created.id;
      }

      // The ask, when present, already carries the observation - speak it alone to
      // avoid repeating the same fact twice.
      const ask = outcome.resolvesObligationLike?.ask ?? outcome.proposeObligation?.ask;
      return reply(ask ?? outcome.spoken, {
        eventId: event.id,
        resolvesCandidate: candidate,
        proposalId,
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 13. "Reorder Mom's prescription." - the purchase, as an offer -----
  server.registerTool('reorder_prescription', {
    title: 'Offer to reorder a prescription',
    description:
      'Some work is closed by buying the thing, not by doing it. When a prescription '
      + 'needs refilling - often the same one a delivery or a pickup gap is about - this '
      + 'prepares a priced OFFER from a pharmacy and presents it. It does NOT buy '
      + 'anything: like every inference here, a purchase is a proposal until a person '
      + 'confirms it with confirm_purchase. Tell them the item, the price and the ETA, '
      + 'and that nothing is charged yet.',
    inputSchema: {
      medicationName: z.string().optional()
        .describe('Which medication to refill, as said (e.g. "heart pill").'),
      obligationId: z.string().optional()
        .describe('The pickup/refill Care Gap this would close, if known.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ medicationName, obligationId }) => {
    try {
      const me = actor();
      requireCap(me, 'make_purchase');
      const offer = offerFor('prescription_refill', {
        offerId: `off_${randomUUID()}`,
        ...(medicationName ? { itemName: medicationName } : {}),
        ...(obligationId ? { obligationId } : {}),
      });
      const event = await store.appendEvent({
        householdId: me.householdId, kind: 'purchase_offered', reportedBy: me.id,
        occurredAt: now().toISOString(), detail: offer.item,
        data: { offer: offer as unknown as Record<string, unknown> },
      });
      return reply(offerSpoken(offer), { eventId: event.id, offer });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 14. "Yes, place it." - the in-place confirmation ------------------
  server.registerTool('confirm_purchase', {
    title: 'Place or decline a prepared purchase',
    description:
      'Confirm a purchase that was offered, or decline it. This is the only step that '
      + 'commits money. On confirmation the order is placed and, if the purchase closes '
      + 'a Care Gap (a prescription pickup), that work is marked done. Only call this '
      + 'when a person has said yes to a specific offer - never on your own judgement.',
    inputSchema: {
      offerId: z.string().describe('The offer being answered, from reorder_prescription.'),
      confirmed: z.boolean().describe('True to place the order, false to decline it.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ offerId, confirmed }) => {
    try {
      const me = actor();
      requireCap(me, 'make_purchase');
      const s = state();
      const offered = s.events.find(
        (e) => e.kind === 'purchase_offered'
          && (e.data['offer'] as PurchaseOffer | undefined)?.offerId === offerId,
      );
      if (!offered) return guidance(`I can't find that offer any more. Ask me to price it again.`);
      const offer = offered.data['offer'] as unknown as PurchaseOffer;

      const already = s.events.find(
        (e) => e.kind === 'purchase_completed' && e.data['offerId'] === offerId,
      );
      if (already) {
        return guidance(`That order was already ${(already.data['placed']) ? 'placed' : 'declined'}.`);
      }

      await store.appendEvent({
        householdId: me.householdId, kind: 'purchase_completed', reportedBy: me.id,
        occurredAt: now().toISOString(),
        detail: confirmed ? `Placed: ${offer.item}` : `Declined: ${offer.item}`,
        data: { offerId, placed: confirmed, amountCents: offer.amountCents, simulated: true },
      });

      if (!confirmed) {
        return reply(`Okay, I won't place it.`, { offerId, placed: false });
      }

      // A confirmed purchase closes the Care Gap it was for, when it names one and
      // the caller may act on it.
      let closed: string | null = null;
      if (offer.obligationId) {
        try {
          const o = store.getObligation(offer.obligationId, me.householdId);
          if (o.status !== 'RESOLVED' && o.status !== 'DISMISSED' && canActOn(me, o)) {
            await store.transition(offer.obligationId, me.householdId, 'RESOLVED', me.id, {
              resolvedAt: now().toISOString(), resolutionNote: `Ordered via ${offer.merchant}.`,
            });
            closed = o.what;
          }
        } catch { /* the gap may have been resolved another way; the order still stands */ }
      }

      const price = formatPrice(offer.amountCents, offer.currency);
      const spoken = closed
        ? `Done - ${offer.item} is ordered for ${price}, and that takes "${closed}" off the list.`
        : `Done - ${offer.item} is ordered for ${price}. You'll get a confirmation from ${offer.merchant}.`;
      return reply(spoken, { offerId, placed: true, amountCents: offer.amountCents, closedObligation: closed });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 15. "Set up a care circle for my mother." - onboarding bootstrap --
  server.registerTool('create_household', {
    title: 'Create a new care circle',
    description:
      'Start a brand-new care circle. This is the one action available to someone who '
      + 'is authenticated but not yet part of any circle: it creates the household and '
      + 'makes the caller its first primary caregiver. Everyone else joins an existing '
      + 'circle via add_member.',
    inputSchema: {
      name: z.string().describe('A name for the care circle, e.g. "Margaret\'s care circle".'),
      timezone: z.string().describe('IANA timezone, e.g. "America/New_York". Medication times are read in it.'),
      callerName: z.string().describe('The founding caregiver\'s name, as they gave it.'),
      spokenAs: z.string().optional().describe('How the caller is referred to when spoken about.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ name, timezone, callerName, spokenAs }) => {
    try {
      const subject = bootstrapSubject(actorId);
      if (!subject) {
        return guidance('You already belong to a care circle, so I can\'t start a new one for you here.');
      }
      if (!isValidTimeZone(timezone)) {
        return guidance(`"${timezone}" isn't a timezone I recognise. Use an IANA name like "America/New_York".`);
      }
      const householdId = `h_${randomUUID()}`;
      const memberId = `m_${randomUUID()}`;
      await store.addHousehold({ id: householdId, name, timezone });
      await store.addMember({
        id: memberId, householdId, name: callerName, role: 'primary_caregiver',
        ...(spokenAs ? { spokenAs } : {}),
      });
      await store.mapIdentity({ subject, memberId, householdId });
      return reply(
        `Done - "${name}" is set up, and you're its primary caregiver. Add the rest of the family with add_member.`,
        { householdId, memberId },
      );
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 16. "Add my sister Renee to the circle." --------------------------
  server.registerTool('add_member', {
    title: 'Add someone to the care circle',
    description:
      'Add a member to this care circle and give them a role: care_recipient, '
      + 'primary_caregiver, caregiver, or helper. Only a primary caregiver can do this. '
      + 'If the new member will sign in, pass the subject their credential carries so '
      + 'they resolve to this member.',
    inputSchema: {
      name: z.string().describe('Their name.'),
      role: z.enum(['care_recipient', 'primary_caregiver', 'caregiver', 'helper'])
        .describe('Their authority in the circle.'),
      spokenAs: z.string().optional().describe('How they are referred to when spoken about.'),
      subject: z.string().optional().describe('The credential subject that authenticates as this member.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ name, role, spokenAs, subject }) => {
    try {
      const me = actor();
      requireCap(me, 'manage_circle');
      const memberId = `m_${randomUUID()}`;
      await store.addMember({
        id: memberId, householdId: me.householdId, name, role,
        ...(spokenAs ? { spokenAs } : {}),
      });
      if (subject) await store.mapIdentity({ subject, memberId, householdId: me.householdId });
      return reply(`Added ${name} to the circle as ${role.replace('_', ' ')}.`, { memberId });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 17. "She takes her heart pill at 8 and 8." -----------------------
  server.registerTool('add_medication', {
    title: 'Add a medication schedule',
    description:
      'Record a medication and the times it is due, so missing doses can be noticed. '
      + 'Times are 24-hour "HH:MM" in the household timezone. Only a primary caregiver '
      + 'can do this.',
    inputSchema: {
      name: z.string().describe('The medication, as the family calls it (e.g. "heart pill").'),
      times: z.array(z.string()).describe('Due times, 24-hour "HH:MM", e.g. ["08:00","20:00"].'),
      forMemberId: z.string().optional().describe('Who it is for. Defaults to the care recipient.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ name, times, forMemberId }) => {
    try {
      const me = actor();
      requireCap(me, 'manage_circle');
      if (!validMedicationTimes(times)) {
        return guidance('I need the dose times as 24-hour "HH:MM" - for example ["08:00","20:00"]. Say them again that way.');
      }
      const forId = forMemberId ?? state().members.find((m) => m.role === 'care_recipient')?.id;
      if (!forId) return guidance('I don\'t know who this medication is for. Tell me which member.');
      const id = `med_${randomUUID()}`;
      await store.addMedication({ id, householdId: me.householdId, name, times, forMemberId: forId });
      return reply(`Added ${name} at ${joinSpoken(times)}.`, { medicationId: id });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 18. "Take Tasha off the circle." ---------------------------------
  server.registerTool('remove_member', {
    title: 'Remove someone from the care circle',
    description:
      'Remove a member. Their open work is not deleted - it is released back to the '
      + 'circle as unowned, so it resurfaces as a Care Gap rather than vanishing. Only '
      + 'a primary caregiver can do this, and the last primary caregiver cannot be '
      + 'removed.',
    inputSchema: {
      memberId: z.string().describe('Who to remove.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ memberId }) => {
    try {
      const me = actor();
      requireCap(me, 'manage_circle');
      if (memberId === me.id) return guidance('You can\'t remove yourself from the circle.');
      const target = store.getMember(memberId);
      if (target.role === 'primary_caregiver'
        && store.membersWithRole(me.householdId, 'primary_caregiver').length <= 1) {
        return guidance('That\'s the only primary caregiver - add another before removing this one.');
      }
      const { released } = await store.removeMember(me.householdId, memberId);
      const tail = released > 0 ? ` ${countPhrase(released, 'piece')} of their work is back on the board.` : '';
      return reply(`Removed ${target.name} from the circle.${tail}`, { memberId, released });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- Resources: the care record, readable as a document ----------------
  // --- Who is speaking -------------------------------------------------
  //
  // Identity is bound to the session credential and checked on every call, and
  // until now it was never *told* to anybody. So the model had to guess who it was
  // talking to, and we watched it do the only honest thing left: David said "I
  // can't do Thursday" and it replied "Are you David?" - asking the one question
  // the server could already answer, and inviting an answer from the conversation,
  // which is exactly the channel identity must never come from.
  //
  // Any authenticated member may read this. It says who the credential speaks for
  // and what that person may do - nothing about anybody else - so it discloses
  // strictly less than the caller already holds.
  server.registerResource('me', 'carecircle://session/me', {
    title: 'Who this session speaks for',
    description:
      'The member this credential identifies, and what they are allowed to do. A host '
      + 'should read this once and never ask the person who they are.',
    mimeType: 'application/json',
  }, async (uri) => {
    const me = actor();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          memberId: me.id,
          name: me.name,
          spokenAs: me.spokenAs ?? null,
          role: me.role,
          can: capabilitiesOf(me),
        }, null, 2),
      }],
    };
  });

  server.registerResource('care-state', 'carecircle://household/state', {
    title: 'Current care state',
    description: 'The full care picture: members, open work, and recent events.',
    mimeType: 'application/json',
  }, async (uri) => {
    const s = state();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          household: s.household,
          members: s.members.map((m) => ({
            id: m.id, name: m.name, role: m.role, spokenAs: m.spokenAs ?? null,
          })),
          // The names this household actually uses. A voice client needs these to
          // map a transcript back onto real people and real medications - general
          // speech recognition knows nothing about "Renee" or a "thyroid tablet",
          // and those are precisely the words it gets wrong.
          medications: s.medications.map((m) => ({
            id: m.id, name: m.name, times: m.times, forMemberId: m.forMemberId,
          })),
          obligations: s.obligations.map((o) => ({
            id: o.id, what: o.what, status: o.status,
            owner: nameOf(o.ownerId) ?? null, dueAt: o.dueAt ?? null,
            provenance: o.provenance.kind,
          })),
          // Doses recorded today, each carrying who says so. A surface that draws
          // this must not flatten a proxy record into the subject's own word.
          doses: s.events
            .filter((e) => e.kind === 'medication_taken'
              && e.occurredAt.slice(0, 10) === now().toISOString().slice(0, 10))
            .map((e) => ({
              medicationId: e.data['medicationId'] ?? null,
              at: e.occurredAt,
              attribution: attributionOf(e),
              saidBy: nameOf(e.reportedBy) ?? null,
            })),
          gaps: detectCareGaps(s, { now: now() }),
          // Purchase offers still awaiting a decision - the in-place buy moment.
          offers: (() => {
            const settled = new Set(s.events
              .filter((e) => e.kind === 'purchase_completed')
              .map((e) => e.data['offerId'] as string));
            return s.events
              .filter((e) => e.kind === 'purchase_offered')
              .map((e) => e.data['offer'] as unknown)
              .filter((o): o is { offerId: string } => !!o && !settled.has((o as { offerId: string }).offerId));
          })(),
          notifications: s.events
            .filter((e) => e.kind === 'member_notified')
            .slice(-5)
            .map((e) => ({
              from: nameOf(e.reportedBy) ?? 'Someone',
              to: nameOf(e.data['recipientId'] as string) ?? 'someone',
              message: e.detail ?? '',
              at: e.occurredAt,
            })),
        }, null, 2),
      }],
    };
  });

  // --- The Care Board: the same answer, drawn instead of spoken ----------
  // Declared as an MCP App (SEP-1865). A host that cannot render it ignores
  // this resource entirely and the spoken path is untouched, which is the whole
  // point of the extension being optional.
  server.registerResource('care-board', CARE_BOARD_URI, {
    title: 'Care board',
    description:
      'The open care gaps as an interactive board: ranked, with the provenance of each '
      + 'one and the arithmetic behind its ranking, and claimable in a tap.',
    mimeType: APP_MIME_TYPE,
    _meta: {
      ui: {
        // The document is entirely self-contained, so it asks for no origins at
        // all - there is nothing for a host to allowlist and nothing that can be
        // injected into a view showing a family's medical coordination.
        csp: { resourceDomains: [], connectDomains: [] },
        prefersBorder: false,
      },
    },
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: APP_MIME_TYPE,
      text: CARE_BOARD_HTML,
    }],
  }));

  // --- Prompts: the questions worth asking regularly ---------------------
  server.registerPrompt('daily-check', {
    title: 'Daily check-in',
    description: 'Walk through how today went and what still needs an owner.',
    argsSchema: {},
  }, () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: 'Give me today\'s care summary, then tell me anything that still has no owner. '
          + 'Read the results as they are written. If something was only expected and not '
          + 'logged, say it has no record - do not say it was missed.',
      },
    }],
  }));

  server.registerPrompt('weekly-review', {
    title: 'Weekly review',
    description: 'What is coming up this week, and what nobody has claimed.',
    argsSchema: {},
  }, () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: 'What is going to fall through the cracks this week? Use the care gaps for the '
          + 'next seven days, read the most urgent ones, and ask who can take them.',
      },
    }],
  }));

  return server;
}

export { can };
