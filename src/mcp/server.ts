import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { detectCareGaps, pendingProposals } from '../domain/gaps.js';
import { proposeFromAppointment } from '../domain/inference.js';
import { can, canActOn, NotPermittedError, require as requireCap } from '../domain/auth.js';
import { CareStore, HouseholdScopeError, NotFoundError } from '../store/store.js';
import { countPhrase, joinSpoken, sentence, speakGaps } from './text.js';
import type { Member } from '../domain/types.js';

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
 * because the model is the audience — it is deciding what to do next, and a stack
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
}

export function createCareCircleServer(ctx: ServerContext): McpServer {
  const { store, actorId } = ctx;
  const now = ctx.now ?? (() => new Date());

  const server = new McpServer(
    { name: 'carecircle', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        'CareCircle tracks what needs to happen for someone being cared for, and who is '
        + 'responsible for it. Speak results as written — they are phrased for a voice '
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
    try {
      const m = store.getMember(id);
      return m.spokenAs ?? m.name;
    } catch { return undefined; }
  };

  // --- 1. "I took my heart pill." ----------------------------------------
  server.registerTool('log_care_event', {
    title: 'Log something that happened',
    description:
      'Record that something happened — a medication taken, a meal eaten, a check-in, '
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

      // A dose logged against a medication we don't know about is still recorded —
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
      'Record a scheduled appointment. This also works out what the appointment probably '
      + 'requires — a ride, someone to come along — and PROPOSES that work for a human to '
      + 'confirm. Proposals are guesses and are never treated as real until confirmed with '
      + 'confirm_proposal. Tell the person what was proposed and ask.',
    inputSchema: {
      kind: z.string().describe('What the appointment is, as said (e.g. "cardiology", "dentist").'),
      startsAt: z.string().describe('ISO timestamp of when it starts.'),
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

      const event = await store.appendEvent({
        householdId: me.householdId,
        kind: 'appointment_scheduled',
        reportedBy: me.id,
        occurredAt: startsAt,
        ...(detail ? { detail } : {}),
        data: { appointmentKind: kind, forMemberId: recipient.id },
      });

      const seeds = proposeFromAppointment(kind, subject, startsAt);
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
        ? `Noted — ${kind} for ${subject}.`
        : `Noted — ${kind} for ${subject}. ${seeds[0]!.ask}`;
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
      + 'should see — "Mom sounded tired", "the doctor changed her dose". Use this when '
      + 'there is something to SAY but nothing specific that must be DONE. If someone needs '
      + 'to take an action, use record_appointment or let the note stand and let them claim it.',
    inputSchema: {
      note: z.string().describe('The observation, in the words it was said.'),
      aboutMemberId: z.string().optional().describe('Who it concerns. Defaults to the care recipient.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ note, aboutMemberId }) => {
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
        data: { aboutMemberId: about },
      });
      return reply("I've added that to the care record.", { eventId: event.id });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 4. "What's going to fall through the cracks this week?" -----------
  server.registerTool('get_care_gaps', {
    title: 'Find what nobody has taken responsibility for',
    description:
      'THE core tool. Returns everything that needs attention and has no owner — unclaimed '
      + 'work, expected records that are missing, and things past their due time. Use this '
      + 'for "what needs doing", "what\'s unassigned", "what might fall through the cracks", '
      + 'or "is anything being missed". Results are already ranked by urgency and already '
      + 'phrased for speech: read them as written. Never restate a missing record as someone '
      + 'having failed to do something.',
    inputSchema: {
      withinDays: z.number().int().positive().max(365).optional()
        .describe('Only include dated items within this many days. Omit for everything.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async ({ withinDays }) => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const gaps = detectCareGaps(state(), {
        now: now(),
        ...(withinDays !== undefined ? { withinDays } : {}),
      });
      return reply(speakGaps(gaps), {
        gaps: gaps.map((g) => ({
          id: g.id, kind: g.kind, severity: g.severity, spoken: g.spoken,
          because: g.because, obligationId: g.obligationId ?? null, score: g.score,
        })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 5. "I'll take that one." ------------------------------------------
  server.registerTool('claim_obligation', {
    title: 'Take responsibility for something',
    description:
      'The speaker takes on a piece of work themselves ("I\'ll do it", "I\'ve got Thursday"). '
      + 'To give work to someone ELSE, use assign_obligation instead. If you are unsure which '
      + 'item they mean, call get_care_gaps and ask rather than guessing.',
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
      return reply(`Done — ${o.what} is yours.`, { obligationId: updated.id, ownerId: me.id });
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
      return reply(`Done — ${o.what} is assigned to ${who}.`, {
        obligationId: updated.id, ownerId: assignee.id,
      });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 7. "Yes, she'll need a ride." -------------------------------------
  server.registerTool('confirm_proposal', {
    title: 'Confirm or dismiss something the system guessed',
    description:
      'The system infers work from appointments (a ride to cardiology, someone to take notes) '
      + 'but never treats a guess as real. This turns a guess into actual work, or dismisses '
      + 'it. Always ask a person before calling this — the confirmation must come from them, '
      + 'not from your own judgement about what seems sensible.',
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
        return guidance(`"${o.what}" has already been settled — it's ${o.status.toLowerCase()}.`);
      }
      await store.transition(obligationId, me.householdId, confirmed ? 'OPEN' : 'DISMISSED', me.id);
      return reply(
        confirmed
          ? `Right — ${o.what}. Nobody's taken it yet. Do you want it?`
          : `Okay, I'll leave that out.`,
        { obligationId, status: confirmed ? 'OPEN' : 'DISMISSED' },
      );
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- 8. "Picked up the prescription." ----------------------------------
  server.registerTool('resolve_obligation', {
    title: 'Mark something as done',
    description: 'Record that a piece of work has been completed.',
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
      return reply(`Marked done — ${o.what}.`, { obligationId });
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
      parts.push(meds.length > 0
        ? sentence(`${countPhrase(meds.length, 'medication')} logged today.`)
        : 'Nothing logged for medications today yet.');
      for (const n of notes.slice(0, 2)) {
        parts.push(`${nameOf(n.reportedBy) ?? 'Someone'} noted: ${n.detail}`);
      }
      if (gaps.length > 0) parts.push(speakGaps(gaps));
      if (proposals.length > 0) {
        parts.push(`There ${proposals.length === 1 ? 'is' : 'are'} also ${countPhrase(proposals.length, 'thing')} I'm not sure about yet.`);
      }
      return reply(parts.join(' '), {
        medicationsLogged: meds.length,
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
      + 'recent notes that change how today should go. Scoped deliberately — it does not '
      + 'expose the whole family record.',
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
      'Send a short message to another member of the care circle — "tell Renee I\'m '
      + 'taking Mom Thursday", "let David know the pharmacy called". Use this when the '
      + 'speaker wants a specific PERSON told something. To record something for the '
      + 'whole family to see later, use add_note instead.',
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
      const event = await store.appendEvent({
        householdId: me.householdId,
        kind: 'member_notified',
        reportedBy: me.id,
        occurredAt: now().toISOString(),
        detail: message,
        data: { recipientId: recipient.id },
      });
      const who = recipient.spokenAs ?? recipient.name;
      return reply(`I'll let ${who} know.`, { eventId: event.id, recipientId: recipient.id });
    } catch (err) { return guidance(describeError(err)); }
  });

  // --- Resources: the care record, readable as a document ----------------
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
          members: s.members.map((m) => ({ id: m.id, name: m.name, role: m.role })),
          obligations: s.obligations.map((o) => ({
            id: o.id, what: o.what, status: o.status,
            owner: nameOf(o.ownerId) ?? null, dueAt: o.dueAt ?? null,
            provenance: o.provenance.kind,
          })),
          gaps: detectCareGaps(s, { now: now() }),
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
          + 'logged, say it has no record — do not say it was missed.',
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
