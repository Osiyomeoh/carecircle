import type { Server } from 'node:http';
import { createCareCircleApp } from './http/app.js';
import { CareStore } from './store/store.js';
import { FilePersistence } from './store/persistence.js';
import { DynamoPersistence } from './store/dynamo.js';
import { seedDemoHousehold, DEMO_TOKENS } from './demo/seed.js';
import { resolverFromEnv } from './http/identity.js';
import { notifierFromEnv } from './notify/notifier.js';
import { loadConfig } from './config.js';
import { log } from './obs/log.js';

/** Entrypoint: validate config, wire real persistence to the app, listen, and shut down cleanly. */

const config = (() => {
  try {
    return loadConfig();
  } catch (err) {
    // A bad config must stop the process now, with a readable reason, not fail later.
    log.error('configuration invalid; refusing to start', { reason: (err as Error).message });
    process.exit(1);
  }
})();

// A deployed runtime has no durable filesystem, so persistence is chosen by config:
// DynamoDB when a table is named, a JSON file for local work.
const persistence = config.persistence === 'dynamodb'
  ? new DynamoPersistence({ tableName: config.tableName!, ...(config.region ? { region: config.region } : {}) })
  : new FilePersistence(config.dbPath);

const store = new CareStore(persistence);
const tokens = new Map<string, string>(Object.entries(DEMO_TOKENS));
const identity = resolverFromEnv(tokens);
const notifier = notifierFromEnv();

// Bind the port FIRST, then load state. A slow or misconfigured storage backend must
// not stop the server coming up and answering its health check — otherwise a
// transient DynamoDB problem reads to the platform as "the app is dead" and the whole
// service fails to deploy. Storage errors are logged, not fatal.
const app = createCareCircleApp({ store, identity, notifier });
const server: Server = app.listen(config.port, '0.0.0.0', () => {
  log.info('carecircle listening', {
    port: config.port, spec: '2025-11-25',
    identity: identity.strategy, storage: config.persistence,
    ...(config.tableName ? { table: config.tableName } : {}),
    notify: notifier.channel, seedDemo: config.seedDemo,
  });
  if (identity.strategy === 'static') {
    for (const [token, memberId] of tokens) log.debug('demo credential', { memberId, token });
  }
});

try {
  await store.init();
  // Demo data is never seeded under real identity — see loadConfig.seedDemo.
  if (config.seedDemo) await seedDemoHousehold(store);
  log.info('care record ready', { households: store.householdCount(), seeded: config.seedDemo });
} catch (err) {
  log.error('storage init failed; serving with an empty record', { reason: (err as Error).message });
}

// --- graceful shutdown ------------------------------------------------------
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown requested', { signal });
  // Stop accepting new connections, then let in-flight requests and the current
  // write finish before the process exits.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000).unref());
  await Promise.race([closed, timeout]);
  try { await store.quiesce(); } catch { /* already logged at the write site */ }
  log.info('shutdown complete', { signal });
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void shutdown(signal); });
}
