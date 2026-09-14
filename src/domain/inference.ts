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
