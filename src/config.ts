/**
 * Boot-time configuration, validated once.
 *
 * A caregiving service should fail loudly at start-up on an incoherent config, not
 * silently at the first tool call in front of a family. Everything the entrypoint
 * needs to decide how to run is resolved and checked here, so `http.ts` stays a
 * straight wiring of already-valid values.
 */

export type Persistence = 'dynamodb' | 'file';
export type IdentityStrategy = 'jwt' | 'static';

export interface Config {
  port: number;
  persistence: Persistence;
  tableName?: string;
  dbPath: string;
  region?: string;
  identity: IdentityStrategy;
  /**
   * Whether to seed the built-in demo household. Never under real (JWT) identity -
   * production must not inject a fake family into a real store - and overridable
   * with CARECIRCLE_SEED_DEMO for a static-identity staging box that wants it off.
   */
  seedDemo: boolean;
}

class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer 1-65535, got "${raw}".`);
  }
  return port;
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`Expected a boolean (true/false), got "${raw}".`);
}

/** Resolve and validate configuration from the environment. Throws on anything unusable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = parsePort(env['PORT']);
  const tableName = env['CARECIRCLE_TABLE']?.trim() || undefined;
  const region = env['AWS_REGION']?.trim() || undefined;
  const persistence: Persistence = tableName ? 'dynamodb' : 'file';

  // A DynamoDB table with no region is the classic silent-failure config: the SDK
  // picks an unexpected default and the data lands nowhere the operator expects.
  if (persistence === 'dynamodb' && !region) {
    throw new ConfigError('CARECIRCLE_TABLE is set but AWS_REGION is not; refusing to start with an ambiguous DynamoDB region.');
  }

  const identity: IdentityStrategy = env['CARECIRCLE_JWT_CLAIM']?.trim() ? 'jwt' : 'static';

  // Demo seeding: off under JWT no matter what, otherwise on unless disabled.
  const seedOverride = parseBool(env['CARECIRCLE_SEED_DEMO']);
  const seedDemo = identity === 'jwt' ? false : (seedOverride ?? true);
  if (seedOverride === true && identity === 'jwt') {
    throw new ConfigError('CARECIRCLE_SEED_DEMO=true with JWT identity: refusing to seed demo data into a production store.');
  }

  return {
    port, persistence, dbPath: env['CARECIRCLE_DB'] ?? 'carecircle.db.json',
    identity, seedDemo,
    ...(tableName ? { tableName } : {}),
    ...(region ? { region } : {}),
  };
}
