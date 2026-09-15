import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, BatchWriteCommand, ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Persistence, StoreSnapshot } from './store.js';

/**
 * DynamoDB persistence.
 *
 * A deployed CareCircle runs on a serverless runtime with no durable filesystem, so
 * the care record has to live somewhere the process does not own. This is the same
 * `Persistence` interface the JSON file implements — the store has no idea which is
 * behind it.
 *
 * Single-table design, one item per entity:
 *
 *   pk = HH#<householdId>      the care circle owns its data
 *   sk = <TYPE>#<id>           EVENT#, OBLIGATION#, MEMBER#, MED#, TRANSITION#, META#
 *
 * Partitioning by household matters beyond performance: it is the same boundary the
 * authorisation model enforces, so a query can never accidentally span families.
 *
 * `save()` receives a whole snapshot, but rewriting every item on every tool call
 * would be wasteful and would burn write capacity for nothing. So we diff against
 * what we last wrote and send only what changed.
 */

type Entity =
  | { kind: 'HOUSEHOLD'; id: string }
  | { kind: 'MEMBER'; id: string }
  | { kind: 'EVENT'; id: string }
  | { kind: 'OBLIGATION'; id: string }
  | { kind: 'MED'; id: string }
  | { kind: 'TRANSITION'; id: string };

interface Row {
  pk: string;
  sk: string;
  kind: Entity['kind'];
  body: unknown;
}

const HOUSEHOLDLESS = 'HH#_root';

/** Every row the snapshot implies, keyed by `pk|sk` so two snapshots can be diffed. */
function rowsFor(snapshot: StoreSnapshot): Map<string, Row> {
  const rows = new Map<string, Row>();
  const add = (pk: string, kind: Entity['kind'], id: string, body: unknown) => {
    const sk = `${kind}#${id}`;
    rows.set(`${pk}|${sk}`, { pk, sk, kind, body });
  };

  for (const h of snapshot.households) add(`HH#${h.id}`, 'HOUSEHOLD', h.id, h);
  for (const m of snapshot.members) add(`HH#${m.householdId}`, 'MEMBER', m.id, m);
  for (const e of snapshot.events) add(`HH#${e.householdId}`, 'EVENT', e.id, e);
  for (const o of snapshot.obligations) add(`HH#${o.householdId}`, 'OBLIGATION', o.id, o);
  for (const m of snapshot.medications) add(`HH#${m.householdId}`, 'MED', m.id, m);
  for (const t of snapshot.transitions) {
    // Transitions carry no household of their own; they belong to their obligation.
    const owner = snapshot.obligations.find((o) => o.id === t.obligationId);
    const pk = owner ? `HH#${owner.householdId}` : HOUSEHOLDLESS;
    add(pk, 'TRANSITION', `${t.obligationId}#${t.at}#${t.to}`, t);
  }
  return rows;
}

function emptySnapshot(): StoreSnapshot {
  return {
    households: [], members: [], events: [],
    obligations: [], medications: [], transitions: [],
  };
}

/** Rebuild a snapshot from rows. Order is restored where it carries meaning. */
function snapshotFrom(rows: Row[]): StoreSnapshot {
  const snapshot = emptySnapshot();
  for (const row of rows) {
    switch (row.kind) {
      case 'HOUSEHOLD': snapshot.households.push(row.body as never); break;
      case 'MEMBER': snapshot.members.push(row.body as never); break;
      case 'EVENT': snapshot.events.push(row.body as never); break;
      case 'OBLIGATION': snapshot.obligations.push(row.body as never); break;
      case 'MED': snapshot.medications.push(row.body as never); break;
      case 'TRANSITION': snapshot.transitions.push(row.body as never); break;
    }
  }
  // The event log is append-only and read in order; DynamoDB does not promise one.
  snapshot.events.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  snapshot.transitions.sort((a, b) => a.at.localeCompare(b.at));
  return snapshot;
}

/** DynamoDB accepts at most 25 items per BatchWrite. */
function chunk<T>(items: T[], size = 25): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface DynamoPersistenceOptions {
  tableName: string;
  region?: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoPersistence implements Persistence {
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;
  /** What we believe is in the table, so `save` can send only differences. */
  #written = new Map<string, string>();

  constructor({ tableName, region, client }: DynamoPersistenceOptions) {
    this.#table = tableName;
    this.#doc = client ?? DynamoDBDocumentClient.from(
      new DynamoDBClient(region ? { region } : {}),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }

  async load(): Promise<StoreSnapshot | null> {
    const rows: Row[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.#doc.send(new ScanCommand({
        TableName: this.#table,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }));
      for (const item of page.Items ?? []) rows.push(item as Row);
      startKey = page.LastEvaluatedKey;
    } while (startKey);

    if (rows.length === 0) return null;

    // Seed the diff baseline so the first save does not rewrite everything we
    // just read back.
    this.#written = new Map(
      rows.map((r) => [`${r.pk}|${r.sk}`, JSON.stringify(r.body)]),
    );
    return snapshotFrom(rows);
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    const desired = rowsFor(snapshot);

    const puts: Row[] = [];
    for (const [key, row] of desired) {
      const serialised = JSON.stringify(row.body);
      if (this.#written.get(key) !== serialised) puts.push(row);
    }
    const deletes = [...this.#written.keys()].filter((key) => !desired.has(key));

    if (puts.length === 0 && deletes.length === 0) return;

    const requests = [
      ...puts.map((row) => ({ PutRequest: { Item: row } })),
      ...deletes.map((key) => {
        const [pk, sk] = key.split('|');
        return { DeleteRequest: { Key: { pk, sk } } };
      }),
    ];

    for (const batch of chunk(requests)) {
      let unprocessed = { [this.#table]: batch };
      // BatchWrite can partially succeed; retry what it did not take, with backoff.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await this.#doc.send(new BatchWriteCommand({
          RequestItems: unprocessed,
        }));
        const remaining = result.UnprocessedItems?.[this.#table] ?? [];
        if (remaining.length === 0) break;
        unprocessed = { [this.#table]: remaining };
        await new Promise((r) => setTimeout(r, 2 ** attempt * 50));
        if (attempt === 4) {
          throw new Error(
            `DynamoDB did not accept ${remaining.length} item(s) after 5 attempts. `
            + 'The care record may be partially written.',
          );
        }
      }
    }

    // Only claim what actually landed.
    for (const row of puts) {
      this.#written.set(`${row.pk}|${row.sk}`, JSON.stringify(row.body));
    }
    for (const key of deletes) this.#written.delete(key);
  }
}
