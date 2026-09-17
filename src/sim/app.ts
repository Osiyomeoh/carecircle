import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SimulatedAlexa } from './host.js';
import { providerFromEnv } from './providers.js';
import { diagnoseBedrock, describe as describeDiagnosis } from './preflight.js';
import { DEMO_TOKENS } from '../demo/seed.js';

/**
 * Simulated Alexa+ experience.
 *
 * Serves the device mock and brokers turns between the browser, a Bedrock model,
 * and the CareCircle MCP server. One host per member, so each device in the demo
 * (Margaret's kitchen Echo, David's phone) keeps its own conversation.
 */

const PORT = Number(process.env['SIM_PORT'] ?? 5173);
const MCP_ENDPOINT = process.env['CARECIRCLE_URL'] ?? 'http://localhost:8787/mcp';
const REGION = process.env['AWS_REGION'] ?? 'us-east-1';
const provider = providerFromEnv();
const MODEL_ID = provider.modelId;

const here = dirname(fileURLToPath(import.meta.url));

/** member id -> its connected host. Created lazily on first utterance. */
const hosts = new Map<string, SimulatedAlexa>();
const tokenFor = new Map(Object.entries(DEMO_TOKENS).map(([token, member]) => [member, token]));

async function hostFor(memberId: string): Promise<SimulatedAlexa> {
  const existing = hosts.get(memberId);
  if (existing) return existing;
  const token = tokenFor.get(memberId);
  if (!token) throw new Error(`No credential for ${memberId}`);
  const host = await SimulatedAlexa.connect({
    endpoint: MCP_ENDPOINT, token, provider,
  });
  hosts.set(memberId, host);
  return host;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Model backends throttle and overload transiently; a demo turn should ride that
 *  out rather than surface it. Retries 429/503/overload with backoff; other
 *  failures (bad credentials, a real bug) are returned at once. */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const m = (err as Error).message ?? '';
      const transient = /\b(429|503)\b|overload|high demand|rate.?limit|too many|throttl|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(m);
      if (!transient || attempt === tries - 1) throw err;
      await sleep(Math.min(8_000, 1_200 * 2 ** attempt));
    }
  }
  throw last;
}

const app = express();
app.use(express.json());
// The built React UI (Vite) is the primary front-end; public/ still holds legacy
// static pages (e.g. tv.html the Fire TV APK points at) and is served as a fallback.
const uiDir = join(here, '../../sim-ui/dist');
app.use(express.static(uiDir));
app.use(express.static(join(here, '../../public')));

/** One spoken turn from one member's device. */
app.post('/api/say', async (req, res) => {
  const { memberId, text } = req.body as { memberId?: string; text?: string };
  if (!memberId || !text) {
    res.status(400).json({ error: 'memberId and text are required' });
    return;
  }
  try {
    const host = await hostFor(memberId);
    const turn = await withRetry(() => host.say(text));
    res.json(turn);
  } catch (err) {
    const message = (err as Error).message;

    // Throttling is the ambiguous one: it means either "you used your budget" or
    // "you never had one", and Bedrock reports both identically. Ask Service
    // Quotas which, rather than telling the user to wait for a refill that will
    // never come.
    // Only Bedrock has the zero-quota failure mode this diagnoses.
    if (provider.name === 'bedrock' && /throttl|too many tokens/i.test(message)) {
      const diagnosis = await diagnoseBedrock({ region: REGION, modelId: MODEL_ID });
      res.status(502).json({
        error: diagnosis.state === 'ok' || diagnosis.state === 'unknown'
          ? `Bedrock is rate limiting: ${message}`
          : describeDiagnosis(diagnosis),
        diagnosis: diagnosis.state,
      });
      return;
    }

    // Credential problems are the most likely failure on a fresh clone, so say so
    // plainly rather than surfacing an opaque SDK error in the UI.
    const isAuth = /credential|security token|AccessDenied|not authorized|region/i.test(message);
    res.status(502).json({
      error: isAuth
        ? `Bedrock could not be reached: ${message}. Check AWS credentials, the region (${REGION}), and that model access is enabled for ${MODEL_ID}.`
        : message,
    });
  }
});

/**
 * A card button tap.
 *
 * This is the feature request in working form: the card carries a bound tool call,
 * and tapping it invokes that tool directly with no model in the loop. Voice is the
 * right input for capture; a tap is the right input for choosing among similar
 * items, where a misheard referring expression would assign a hospital trip to the
 * wrong person.
 */
app.post('/api/act', async (req, res) => {
  const { memberId, tool, args } = req.body as {
    memberId?: string; tool?: string; args?: Record<string, unknown>;
  };
  if (!memberId || !tool) {
    res.status(400).json({ error: 'memberId and tool are required' });
    return;
  }
  try {
    const host = await hostFor(memberId);
    const out = await withRetry(() => host.callToolDirect(tool, args ?? {}));
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * The live care board. Read through the MCP server's own resource, so the panel
 * shows exactly what the protocol exposes - not a privileged side channel.
 */
app.get('/api/state', async (_req, res) => {
  try {
    const token = tokenFor.get('m_david');
    const response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'carecircle-board', version: '0.1.0' },
        },
      }),
    });
    const sessionId = response.headers.get('mcp-session-id');
    await response.text();
    if (!sessionId) throw new Error('No session id returned by the MCP server');

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    };
    await fetch(MCP_ENDPOINT, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    const read = await fetch(MCP_ENDPOINT, {
      method: 'POST', headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'resources/read',
        params: { uri: 'carecircle://household/state' },
      }),
    });
    const body = await read.json() as { result?: { contents?: { text?: string }[] } };
    void fetch(MCP_ENDPOINT, { method: 'DELETE', headers }).catch(() => undefined);
    res.json(JSON.parse(body.result?.contents?.[0]?.text ?? '{}'));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({
    provider: provider.name, region: REGION, modelId: MODEL_ID, endpoint: MCP_ENDPOINT,
  });
});

// SPA fallback: any non-API GET that isn't a static file serves the React app,
// so client-side routes (/console, /tv) work on direct load and refresh.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(join(uiDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Alexa+ simulator on http://localhost:${PORT}`);
  console.log(`  talking to MCP server at ${MCP_ENDPOINT}`);
  console.log(`  planner: ${provider.name} · ${MODEL_ID}`);
});
