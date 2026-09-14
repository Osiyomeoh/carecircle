/**
 * Tool-selection corpus.
 *
 * Each case is something a real member of a care circle would say, paired with the
 * tool the server intends them to reach. This measures the one thing that decides
 * whether an MCP server is any good in practice: given only the tool descriptions,
 * does the model pick the right tool?
 *
 * `expect` lists every acceptable first call. Some utterances legitimately admit
 * more than one route — "I'll take the cardiology one" may reasonably begin with
 * get_care_gaps to resolve which item is meant — and marking those as failures
 * would measure our opinions rather than the model's judgement.
 *
 * `expectNone` marks utterances where reaching for a tool at all is the error.
 */

export interface EvalCase {
  id: string;
  /** Who is speaking. Their role changes what is plausible. */
  member: 'm_margaret' | 'm_david' | 'm_renee' | 'm_aide';
  utterance: string;
  /** Acceptable first tool calls. */
  expect?: string[];
  /** True when the right behaviour is to answer or ask, not to call a tool. */
  expectNone?: boolean;
  /** Argument assertions on the chosen call. */
  args?: Record<string, (value: unknown) => boolean>;
  /** Why this case exists, when it is not obvious. */
  note?: string;
}

const contains = (needle: string) => (v: unknown) =>
  typeof v === 'string' && v.toLowerCase().includes(needle);

export const CORPUS: EvalCase[] = [
  // --- Margaret logs her own life ---------------------------------------
  { id: 'log-01', member: 'm_margaret', utterance: 'I took my heart pill.', expect: ['log_care_event'] },
  { id: 'log-02', member: 'm_margaret', utterance: 'Just took my thyroid tablet.', expect: ['log_care_event'] },
  { id: 'log-03', member: 'm_margaret', utterance: "I've had my morning tablets.", expect: ['log_care_event'] },
  { id: 'log-04', member: 'm_margaret', utterance: 'I took the little white one about an hour ago.', expect: ['log_care_event'],
    note: 'Vague medication name — should still log, or ask which one.' },
  { id: 'log-05', member: 'm_margaret', utterance: "I'm feeling alright today.", expect: ['log_care_event', 'add_note'] },
  { id: 'log-06', member: 'm_margaret', utterance: 'I had my pills with breakfast.', expect: ['log_care_event'] },
  { id: 'log-07', member: 'm_david', utterance: 'Mom took her evening pill, I watched her.', expect: ['log_care_event'],
    note: 'Logging on behalf of someone else.' },
  { id: 'log-08', member: 'm_aide', utterance: 'Margaret took her heart tablet at two.', expect: ['log_care_event'] },

  // --- Appointments ------------------------------------------------------
  { id: 'appt-01', member: 'm_renee', utterance: 'Mom has cardiology on Thursday at ten.', expect: ['record_appointment'],
    args: { kind: contains('cardio') } },
  { id: 'appt-02', member: 'm_margaret', utterance: 'I have a dentist appointment next Tuesday at 2pm.', expect: ['record_appointment'] },
  { id: 'appt-03', member: 'm_david', utterance: 'Put Mom down for physical therapy Friday morning at nine.', expect: ['record_appointment'] },
  { id: 'appt-04', member: 'm_renee', utterance: 'The clinic moved her bloodwork to Monday at eight.', expect: ['record_appointment'] },
  { id: 'appt-05', member: 'm_david', utterance: "She's got an eye test on the fourth at 11:30.", expect: ['record_appointment'] },
  { id: 'appt-06', member: 'm_renee', utterance: 'Book club is Wednesday evening at seven.', expect: ['record_appointment'],
    note: 'Non-medical: should record but propose no transport.' },

  // --- Notes and observations -------------------------------------------
  { id: 'note-01', member: 'm_renee', utterance: 'Mom sounded tired on the phone.', expect: ['add_note'] },
  { id: 'note-02', member: 'm_david', utterance: 'The doctor changed her dose to twice a day.', expect: ['add_note'] },
  { id: 'note-03', member: 'm_aide', utterance: "She didn't eat much lunch today.", expect: ['add_note'] },
  { id: 'note-04', member: 'm_renee', utterance: 'Just so everyone knows, the pharmacy called about the refill.', expect: ['add_note'] },
  { id: 'note-05', member: 'm_david', utterance: 'She seemed a bit confused this morning but fine by lunch.', expect: ['add_note'] },
  { id: 'note-06', member: 'm_aide', utterance: 'Her ankles looked a little swollen.', expect: ['add_note'] },

  // --- The core question -------------------------------------------------
  { id: 'gap-01', member: 'm_david', utterance: "What's going to fall through the cracks this week?", expect: ['get_care_gaps'] },
  { id: 'gap-02', member: 'm_david', utterance: "What hasn't been assigned?", expect: ['get_care_gaps'] },
  { id: 'gap-03', member: 'm_renee', utterance: 'Is anything being missed with Mom?', expect: ['get_care_gaps'] },
  { id: 'gap-04', member: 'm_david', utterance: 'What still needs doing for Mom?', expect: ['get_care_gaps'] },
  { id: 'gap-05', member: 'm_renee', utterance: 'What does Mom need this week?', expect: ['get_care_gaps', 'get_care_summary'] },
  { id: 'gap-06', member: 'm_david', utterance: 'Is there anything nobody has picked up?', expect: ['get_care_gaps'] },
  { id: 'gap-07', member: 'm_david', utterance: 'Anything I need to worry about?', expect: ['get_care_gaps', 'get_care_summary'] },
  { id: 'gap-08', member: 'm_renee', utterance: 'What are the open items?', expect: ['get_care_gaps'] },

  // --- Claiming ----------------------------------------------------------
  { id: 'claim-01', member: 'm_david', utterance: "I'll take the cardiology one.", expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'claim-02', member: 'm_david', utterance: "I've got Thursday.", expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'claim-03', member: 'm_renee', utterance: "I'll do the prescription pickup.", expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'claim-04', member: 'm_david', utterance: "I'll handle both of those.", expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'claim-05', member: 'm_aide', utterance: "I can take that one.", expect: ['claim_obligation', 'get_care_gaps', 'get_shift_brief'] },
  { id: 'claim-06', member: 'm_renee', utterance: 'Put me down for the drive.', expect: ['claim_obligation', 'get_care_gaps'] },

  // --- Assigning (distinct from claiming) --------------------------------
  { id: 'assign-01', member: 'm_david', utterance: 'Give the pharmacy run to Renee.', expect: ['assign_obligation', 'get_care_gaps'],
    note: 'Must not be confused with claim_obligation.' },
  { id: 'assign-02', member: 'm_david', utterance: 'Ask Renee to take Thursday.', expect: ['assign_obligation', 'notify_member', 'get_care_gaps'] },
  { id: 'assign-03', member: 'm_david', utterance: 'Renee should do the prescription.', expect: ['assign_obligation', 'get_care_gaps'] },
  { id: 'assign-04', member: 'm_renee', utterance: 'Assign the cardiology drive to David.', expect: ['assign_obligation', 'get_care_gaps'],
    note: 'Renee lacks the capability — the tool should refuse, but choosing it is correct.' },
  { id: 'assign-05', member: 'm_david', utterance: 'Can Tasha cover the Monday visit?', expect: ['assign_obligation', 'notify_member', 'get_care_gaps'] },

  // --- Confirming what the system guessed --------------------------------
  { id: 'confirm-01', member: 'm_renee', utterance: "Yes, she'll need a ride.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'confirm-02', member: 'm_david', utterance: "No, she doesn't need anyone to go in with her.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'confirm-03', member: 'm_renee', utterance: "That's right, someone should drive her.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'confirm-04', member: 'm_david', utterance: 'She can get herself there, leave it out.', expect: ['confirm_proposal', 'get_care_gaps'] },

  // --- Resolving ---------------------------------------------------------
  { id: 'resolve-01', member: 'm_renee', utterance: 'Picked up the prescription.', expect: ['resolve_obligation', 'get_care_gaps'] },
  { id: 'resolve-02', member: 'm_david', utterance: 'Took her to cardiology, all done.', expect: ['resolve_obligation', 'get_care_gaps'] },
  { id: 'resolve-03', member: 'm_aide', utterance: 'Finished the shopping for her.', expect: ['resolve_obligation', 'get_care_gaps', 'get_shift_brief'] },
  { id: 'resolve-04', member: 'm_renee', utterance: "That's sorted now.", expect: ['resolve_obligation', 'get_care_gaps'] },

  // --- How is she doing --------------------------------------------------
  { id: 'sum-01', member: 'm_david', utterance: "How's Mom doing today?", expect: ['get_care_summary'] },
  { id: 'sum-02', member: 'm_renee', utterance: 'Catch me up on Mom.', expect: ['get_care_summary'] },
  { id: 'sum-03', member: 'm_david', utterance: 'What happened with Mom today?', expect: ['get_care_summary'] },
  { id: 'sum-04', member: 'm_renee', utterance: 'Has Mom taken her medication today?', expect: ['get_care_summary', 'get_care_gaps'],
    note: 'The answer must never assert that she did not.' },
  { id: 'sum-05', member: 'm_david', utterance: 'Did Mom take her evening pill?', expect: ['get_care_summary', 'get_care_gaps'],
    note: 'The trust model case: absence of a record is not a no.' },

  // --- The aide's shift ---------------------------------------------------
  { id: 'shift-01', member: 'm_aide', utterance: 'What do I need to know today?', expect: ['get_shift_brief'] },
  { id: 'shift-02', member: 'm_aide', utterance: "What's on for this shift?", expect: ['get_shift_brief'] },
  { id: 'shift-03', member: 'm_aide', utterance: 'What medications is she on today?', expect: ['get_shift_brief'] },
  { id: 'shift-04', member: 'm_aide', utterance: 'Anything assigned to me?', expect: ['get_shift_brief', 'get_care_gaps'] },

  // --- Telling a person ---------------------------------------------------
  { id: 'notify-01', member: 'm_david', utterance: "Tell Renee I'm taking Mom Thursday.", expect: ['notify_member'] },
  { id: 'notify-02', member: 'm_renee', utterance: 'Let David know the pharmacy called.', expect: ['notify_member'] },
  { id: 'notify-03', member: 'm_david', utterance: 'Message Renee about the appointment change.', expect: ['notify_member'] },
  { id: 'notify-04', member: 'm_aide', utterance: 'Let the family know she slept badly.', expect: ['notify_member', 'add_note'] },

  // --- Constraints: work coming loose -------------------------------------
  { id: 'cons-01', member: 'm_renee', utterance: "I can't drive Thursday, I'm out of town.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'cons-02', member: 'm_david', utterance: "I'm away all next week.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'cons-03', member: 'm_renee', utterance: "I won't be able to make Friday after all.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'cons-04', member: 'm_aide', utterance: "I'm off sick tomorrow.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },

  // --- Nothing to call ----------------------------------------------------
  { id: 'none-01', member: 'm_margaret', utterance: 'Thank you, that\'s all.', expectNone: true },
  { id: 'none-02', member: 'm_david', utterance: 'What can you help me with?', expectNone: true },
  { id: 'none-03', member: 'm_margaret', utterance: "What's the weather like?", expectNone: true,
    note: 'Out of scope — must not reach for a care tool.' },
  { id: 'none-04', member: 'm_renee', utterance: 'Never mind.', expectNone: true },
];

export const MEMBER_LABEL: Record<EvalCase['member'], string> = {
  m_margaret: 'Margaret (care recipient)',
  m_david: 'David (primary caregiver)',
  m_renee: 'Renee (caregiver)',
  m_aide: 'Tasha (paid aide)',
};
