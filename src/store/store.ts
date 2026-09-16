import { randomUUID } from 'node:crypto';
import type {
  CareEvent, CareState, Household, Member, MedicationSchedule, Obligation,
} from '../domain/types.js';

/**
 * Append-only care store.
 *
 * Events are never mutated or deleted: care state is a fold over the log. That is
 * what makes "who said what, and when" always answerable, which the provenance
 * model in docs/DESIGN.md depends on. Obligations do change status over their
 * lifetime, and every transition is recorded with who caused it.
 */

export interface ObligationTransition {
  obligationId: string;
  from: Obligation['status'];
  to: Obligation['status'];
  byMemberId: string;
  at: string;
  note?: string;
}

/** Persistence is deliberately behind an interface so hosting can change later. */
export interface Persistence {
  load(): Promise<StoreSnapshot | null>;
  save(snapshot: StoreSnapshot): Promise<void>;
}

export interface StoreSnapshot {
  households: Household[];
  members: Member[];
  events: CareEvent[];
  obligations: Obligation[];
  medications: MedicationSchedule[];
  transitions: ObligationTransition[];
}

function emptySnapshot(): StoreSnapshot {
  return {
    households: [], members: [], events: [],
    obligations: [], medications: [], transitions: [],
  };
}

/** Raised when a caller tries to act outside their household. */
export class HouseholdScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HouseholdScopeError';
  }
}

/** Raised when something referenced does not exist. Carries what was looked for. */
export class NotFoundError extends Error {
  readonly what: string;
  readonly id: string;

  constructor(what: string, id: string) {
    super(`No ${what} found with id ${id}`);
    this.name = 'NotFoundError';
    this.what = what;
    this.id = id;
  }
}

export class CareStore {
  #snapshot: StoreSnapshot = emptySnapshot();
  #persistence: Persistence | undefined;
  /** Serialises writes so concurrent tool calls cannot interleave a save. */
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor(persistence?: Persistence) {
    this.#persistence = persistence;
  }

  async init(): Promise<void> {
    const loaded = await this.#persistence?.load();
    if (loaded) this.#snapshot = loaded;
  }

  /** Run a mutation and persist, with writes serialised. */
  async #write<T>(fn: () => T): Promise<T> {
    const run = this.#writeQueue.then(async () => {
      const result = fn();
      await this.#persistence?.save(this.#snapshot);
      return result;
    });
    // Keep the queue alive even if this write rejects.
    this.#writeQueue = run.catch(() => undefined);
    return run;
  }

  // --- reads -------------------------------------------------------------

  /** Everything the gap engine needs, scoped to one household. */
  getCareState(householdId: string): CareState {
    const household = this.#snapshot.households.find((h) => h.id === householdId);
    if (!household) throw new NotFoundError('household', householdId);
    return {
      household,
      members: this.#snapshot.members.filter((m) => m.householdId === householdId),
      events: this.#snapshot.events.filter((e) => e.householdId === householdId),
      obligations: this.#snapshot.obligations.filter((o) => o.householdId === householdId),
      medications: this.#snapshot.medications.filter((m) => m.householdId === householdId),
    };
  }

  /** How many households are loaded. Used by the health check. */
  householdCount(): number {
    return this.#snapshot.households.length;
  }

  getMember(memberId: string): Member {
    const m = this.#snapshot.members.find((x) => x.id === memberId);
    if (!m) throw new NotFoundError('member', memberId);
    return m;
  }

  findMemberByName(householdId: string, name: string): Member | undefined {
    const needle = name.trim().toLowerCase();
    return this.#snapshot.members.find((m) =>
      m.householdId === householdId
      && (m.name.toLowerCase() === needle || m.spokenAs?.toLowerCase() === needle));
  }

  getObligation(id: string, householdId: string): Obligation {
    const o = this.#snapshot.obligations.find((x) => x.id === id);
    if (!o) throw new NotFoundError('obligation', id);
    if (o.householdId !== householdId) {
      throw new HouseholdScopeError('That item belongs to a different household.');
    }
    return o;
  }

  getMedications(householdId: string): MedicationSchedule[] {
    return this.#snapshot.medications.filter((m) => m.householdId === householdId);
  }

  /** Audit trail for one obligation, oldest first. */
  getTransitions(obligationId: string): ObligationTransition[] {
    return this.#snapshot.transitions.filter((t) => t.obligationId === obligationId);
  }

  // --- writes ------------------------------------------------------------

  appendEvent(
    event: Omit<CareEvent, 'id' | 'recordedAt'> & Partial<Pick<CareEvent, 'id'>>,
  ): Promise<CareEvent> {
    return this.#write(() => {
      const full: CareEvent = {
        ...event,
        id: event.id ?? `evt_${randomUUID()}`,
        recordedAt: new Date().toISOString(),
      };
      this.#snapshot.events.push(full);
      return full;
    });
  }

  createObligation(
    obligation: Omit<Obligation, 'id' | 'createdAt'> & Partial<Pick<Obligation, 'id'>>,
  ): Promise<Obligation> {
    return this.#write(() => {
      const full: Obligation = {
        ...obligation,
        id: obligation.id ?? `obl_${randomUUID()}`,
        createdAt: new Date().toISOString(),
      };
      this.#snapshot.obligations.push(full);
      return full;
    });
  }

  /**
   * Move an obligation to a new status, recording who did it.
   *
   * Returns the updated obligation. Callers are responsible for checking that
   * the transition is legal for the actor's role — see auth.ts.
   */
  transition(
    id: string,
    householdId: string,
    to: Obligation['status'],
    byMemberId: string,
    changes: Partial<Pick<Obligation, 'ownerId' | 'resolutionNote' | 'resolvedAt'>> = {},
    note?: string,
  ): Promise<Obligation> {
    return this.#write(() => {
      const o = this.getObligation(id, householdId);
      const from = o.status;
      o.status = to;
      if ('ownerId' in changes) o.ownerId = changes.ownerId ?? null;
      if (changes.resolutionNote !== undefined) o.resolutionNote = changes.resolutionNote;
      if (changes.resolvedAt !== undefined) o.resolvedAt = changes.resolvedAt;
      this.#snapshot.transitions.push({
        obligationId: id, from, to, byMemberId,
        at: new Date().toISOString(),
        ...(note ? { note } : {}),
      });
      return o;
    });
  }

  // --- setup -------------------------------------------------------------

  addHousehold(h: Household): Promise<Household> {
    return this.#write(() => { this.#snapshot.households.push(h); return h; });
  }

  addMember(m: Member): Promise<Member> {
    return this.#write(() => { this.#snapshot.members.push(m); return m; });
  }

  addMedication(m: MedicationSchedule): Promise<MedicationSchedule> {
    return this.#write(() => { this.#snapshot.medications.push(m); return m; });
  }

  /** Replace all state. Used by the demo seeder and by tests. */
  async reset(snapshot: StoreSnapshot = emptySnapshot()): Promise<void> {
    await this.#write(() => { this.#snapshot = snapshot; });
  }
}
