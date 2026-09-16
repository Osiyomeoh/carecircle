import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCareCircleServer } from '../mcp/server.js';
import type { CareStore } from '../store/store.js';
import { staticTokens, type IdentityResolver } from './identity.js';
import { RecordOnlyNotifier, type Notifier } from '../notify/notifier.js';

/**
 * Streamable HTTP transport (MCP spec 2025-11-25).
 *
 * The identity model lives here. Each member of a care circle holds their own
 * credential, and a session is bound to one member at initialize time. Everything
 * afterwards is attributed to that member — never to whoever the conversation
 * claims to be, because a model can be talked into believing anything about who
 * is speaking, and this server assigns responsibility for someone's medical care.
 *
 * A session whose credential later changes is rejected outright rather than
 * re-bound: that would be one person acting with another's authority.
 */

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** The member this session speaks for, fixed at initialize. */
  actorId: string;
}

const sessions = new Map<string, Session>();

export interface AppOptions {
  store: CareStore;
  /**
   * How a request's member is established. Defaults to the static token map for
   * local development; production passes a JWT resolver. See ./identity.ts.
   */
  identity?: IdentityResolver;
  /** token -> member id, used when no resolver is given. */
  tokens?: Map<string, string>;
  /** How notify_member delivers. Defaults to record-only. */
  notifier?: Notifier;
}

/**
 * Build the MCP HTTP app. Exported as a factory so the identity and session rules
 * can be attacked directly in tests over real HTTP, rather than trusted.
 */
export function createCareCircleApp({ store, identity, tokens, notifier }: AppOptions): express.Express {
const resolver = identity ?? staticTokens(tokens ?? new Map());
const messenger = notifier ?? new RecordOnlyNotifier();
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  // Report ready even before the store has loaded: the process is up and can serve.
  // A storage problem shows as households:0, not as a dead service.
  let households = -1;
  try { households = store.householdCount(); } catch { /* not ready yet */ }
  res.json({
    ok: true, protocol: '2025-11-25', sessions: sessions.size,
    identity: resolver.strategy, households,
  });
});

const actorFor = (req: express.Request): string | null => resolver.resolve(req);

function rpcError(res: express.Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/** `connect` accepts the SDK's own transport; see docs/FRICTION-LOG.md for the cast. */
type ConnectArg = Parameters<McpServer['connect']>[0];

app.post('/mcp', async (req, res) => {
  const actorId = actorFor(req);
  if (!actorId) {
    res.set('WWW-Authenticate', 'Bearer realm="carecircle"');
    rpcError(res, 401, -32001,
      'Unauthorized: this server needs to know which member of the care circle you are.');
    return;
  }

  const sessionId = req.header('mcp-session-id');

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      rpcError(res, 404, -32001, 'Unknown session. Start a new one with initialize.');
      return;
    }
    // The credential and the session must agree for the whole life of the session.
    if (session.actorId !== actorId) {
      rpcError(res, 403, -32001,
        'This session belongs to a different member of the care circle.');
      return;
    }
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  if (!isInitializeRequest(req.body)) {
    rpcError(res, 400, -32000, 'Expected an initialize request to start a session.');
    return;
  }

  const server = createCareCircleServer({ store, actorId, notifier: messenger });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => { sessions.set(id, { server, transport, actorId }); },
    onsessionclosed: (id) => { sessions.delete(id); },
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  try {
    await server.connect(transport as unknown as ConnectArg);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[carecircle] initialize failed', err);
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
  }
});

/** SSE stream for server-initiated messages, and session teardown. */
for (const method of ['get', 'delete'] as const) {
  app[method]('/mcp', async (req, res) => {
    const actorId = actorFor(req);
    const sessionId = req.header('mcp-session-id');
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!actorId || !session || session.actorId !== actorId) {
      rpcError(res, session ? 403 : 404, -32001, 'No such session for this credential.');
      return;
    }
    await session.transport.handleRequest(req, res);
  });
}

  return app;
}
