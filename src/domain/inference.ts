import type { ConsequenceClass, Obligation } from './types.js';

/**
 * Inference rules: turning an event into work somebody probably has to do.
 *
 * Every rule here produces a PROPOSED obligation, never an OPEN one. The system
 * is allowed to notice that an appointment probably needs a ride; it is not
 * allowed to decide that on the family's behalf. Inference proposes, humans
 * dispose — see docs/DESIGN.md section 2.
 *
 * Rules are declarative and named so that every proposal can explain itself:
 * "I'm guessing, from the cardiology appointment, that she'll need a ride."
 */

export interface InferenceRule {
  /** Stable id, recorded in provenance so a proposal is always traceable. */
  id: string;
  /** Appointment kinds this fires for. */
  appliesTo: (appointmentKind: string) => boolean;
  /** How to phrase the work. */
  what: (subject: string, appointmentKind: string) => string;
  consequence: ConsequenceClass;
  /** How to ask a human whether this is actually needed. */
  ask: (subject: string, appointmentKind: string) => string;
}

const MEDICAL = /cardiolog|doctor|clinic|hospital|dentist|physical therapy|oncolog|dialysis|surgery|specialist|appointment|checkup|check-up|lab|bloodwork|x-ray|scan|mri/i;

export const RULES: InferenceRule[] = [
  {
    id: 'medical-appointment-transport',
    appliesTo: (kind) => MEDICAL.test(kind),
    what: (subject, kind) => `Drive ${subject} to ${kind}`,
    consequence: 'medical',
    ask: (subject, kind) =>
      `Will ${subject} need a ride to ${kind}? I'm guessing from the appointment type, not from anything anyone told me.`,
  },
  {
    id: 'medical-appointment-companion',
    appliesTo: (kind) => /cardiolog|oncolog|surgery|specialist|dialysis/i.test(kind),
    what: (subject, kind) => `Go with ${subject} to ${kind} and take notes`,
    consequence: 'medical',
    ask: (subject, kind) =>
      `Should someone go in with ${subject} for ${kind}? Appointments like this often carry instructions worth writing down.`,
  },
];

export interface ProposalSeed {
  what: string;
  consequence: ConsequenceClass;
  provenance: Extract<Obligation['provenance'], { kind: 'INFERRED' }>;
  /** The question to put to a human before this becomes real work. */
  ask: string;
  dueAt?: string;
}

/**
 * Propose the work an appointment probably implies.
 *
 * Returns seeds, not obligations: the caller decides whether to persist them and
 * how to ask. Nothing here asserts anything about the world.
 */
export function proposeFromAppointment(
  appointmentKind: string,
  subject: string,
  startsAt: string,
): ProposalSeed[] {
  return RULES
    .filter((rule) => rule.appliesTo(appointmentKind))
    .map((rule) => ({
      what: rule.what(subject, appointmentKind),
      consequence: rule.consequence,
      provenance: {
        kind: 'INFERRED' as const,
        rule: rule.id,
        from: `${appointmentKind} appointment`,
      },
      ask: rule.ask(subject, appointmentKind),
      // The work is due when the appointment starts, not after it.
      dueAt: startsAt,
    }));
}


/**
 * Constraints: obligations discovered from what someone says they *cannot* do.
 *
 * This is the deeper half of obligation discovery. An appointment implies work that
 * does not exist yet. A constraint does something else: it *orphans work that
 * already has an owner*. Nobody says "create a task" — somebody says "I can't drive
 * Thursday", and a ride that was covered silently stops being covered.
 *
 * That silence is precisely the failure mode CareCircle exists to catch, so the
 * orphaned obligation is surfaced the same way as any other inference: as a
 * proposal, explaining what it noticed and what it is guessing.
 */

export interface Unavailability {
  /** Who is unavailable. */
  memberId: string;
  /** ISO window they cannot cover. */
  from: string;
  to: string;
  /** What they said, verbatim. */
  said?: string;
}

export interface OrphanedWork {
  obligationId: string;
  what: string;
  /** The question to put to a human about who picks this up. */
  ask: string;
}

/**
 * Find work that a stated unavailability leaves without a real owner.
 *
 * Returns descriptions, not decisions: CareCircle never silently reassigns someone
 * else's responsibility. It notices, and it asks.
 */
export function orphanedBy(
  unavailability: Unavailability,
  obligations: Obligation[],
  nameOf: (memberId: string) => string,
): OrphanedWork[] {
  const from = new Date(unavailability.from).getTime();
  const to = new Date(unavailability.to).getTime();
  const who = nameOf(unavailability.memberId);

  return obligations
    .filter((o) => o.ownerId === unavailability.memberId)
    .filter((o) => o.status === 'ASSIGNED')
    .filter((o) => {
      if (!o.dueAt) return false;
      const due = new Date(o.dueAt).getTime();
      return due >= from && due <= to;
    })
    .map((o) => ({
      obligationId: o.id,
      what: o.what,
      ask: `${who} has "${o.what}" but just said they aren't available then. `
        + 'Does someone else need to pick it up?',
    }));
}
