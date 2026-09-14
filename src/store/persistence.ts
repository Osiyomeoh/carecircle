import { readFile, writeFile, rename } from 'node:fs/promises';
import type { Persistence, StoreSnapshot } from './store.js';

/**
 * JSON-file persistence.
 *
 * Deliberately simple and dependency-free so the server runs anywhere a judge
 * clones it, with no database to provision. Writes go through a temp file and a
 * rename so a crash mid-write cannot truncate the care record.
 */
export class FilePersistence implements Persistence {
  readonly #path: string;

  constructor(path: string) { this.#path = path; }

  async load(): Promise<StoreSnapshot | null> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf8')) as StoreSnapshot;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    const tmp = `${this.#path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    await rename(tmp, this.#path);
  }
}
