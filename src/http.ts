import { createCareCircleApp } from './http/app.js';
import { CareStore } from './store/store.js';
import { FilePersistence } from './store/persistence.js';
import { seedDemoHousehold, DEMO_TOKENS } from './demo/seed.js';
import { resolverFromEnv } from './http/identity.js';

/** Entrypoint: wire real persistence to the app and listen. */

const PORT = Number(process.env['PORT'] ?? 8787);
const DB_PATH = process.env['CARECIRCLE_DB'] ?? 'carecircle.db.json';

const store = new CareStore(new FilePersistence(DB_PATH));
await store.init();
await seedDemoHousehold(store);

const tokens = new Map<string, string>(Object.entries(DEMO_TOKENS));
const identity = resolverFromEnv(tokens);

// AgentCore Runtime expects the server on 0.0.0.0:8000/mcp.
createCareCircleApp({ store, identity }).listen(PORT, '0.0.0.0', () => {
  console.log(`CareCircle MCP server on http://0.0.0.0:${PORT}/mcp  (spec 2025-11-25)`);
  console.log(`Identity: ${identity.strategy}`);
  if (identity.strategy === 'static') {
    console.log('Demo credentials:');
    for (const [token, memberId] of tokens) console.log(`  ${memberId.padEnd(14)} Bearer ${token}`);
  }
});
