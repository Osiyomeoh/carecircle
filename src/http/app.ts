import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCareCircleServer } from '../mcp/server.js';
import type { CareStore } from '../store/store.js';
import { staticTokens, firstOf, BOOTSTRAP_PREFIX, type IdentityResolver } from './identity.js';
import { RecordOnlyNotifier, type Notifier } from '../notify/notifier.js';
import { log } from '../obs/log.js';
import { createRingWebhook } from './ring-webhook.js';
import { OAuthProvider, oauthResolver } from './oauth.js';

/**
 * Streamable HTTP transport (MCP spec 2025-11-25).
 *
 * The identity model lives here. Each member of a care circle holds their own
 * credential, and a session is bound to one member at initialize time. Everything
 * afterwards is attributed to that member - never to whoever the conversation
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
  /**
   * The clock. Defaults to real time. Injectable so a deterministic walkthrough can
   * run "as of" the moment the story is set - e.g. 8:05pm, when an evening dose is
   * genuinely overdue and the absence beat has something real to surface.
   */
  now?: () => Date;
  /**
   * Whether an authenticated-but-unmapped caller may bootstrap a new household. Only
   * applies to the built-in static resolver (ignored when `identity` is supplied).
   * Defaults to the CARECIRCLE_ALLOW_SELF_SIGNUP env var.
   */
  allowSelfSignup?: boolean;
}

/**
 * Build the MCP HTTP app. Exported as a factory so the identity and session rules
 * can be attacked directly in tests over real HTTP, rather than trusted.
 */
export function createCareCircleApp({ store, identity, tokens, notifier, now, allowSelfSignup }: AppOptions): express.Express {
// Runtime-provisioned members authenticate via the persisted identity map.
const lookup = (subject: string): string | null => store.resolveIdentity(subject)?.memberId ?? null;
// An OAuth access token this server issued authenticates ahead of a demo token,
// because it is the one we can actually verify. Composed in one place - see
// resolverFromEnv - so the factory and the production entrypoint cannot disagree.
const demoResolver = staticTokens(tokens ?? new Map(), lookup, allowSelfSignup);
const oauthSecretForAuth = process.env['CARECIRCLE_OAUTH_SECRET'] ?? '';
const resolver = identity
  ?? (oauthSecretForAuth
    ? firstOf(oauthResolver(oauthSecretForAuth, lookup), demoResolver)
    : demoResolver);
const messenger = notifier ?? new RecordOnlyNotifier();
const app = express();

// The Ring webhook is mounted BEFORE the JSON parser and takes the raw bytes.
// An HMAC has to be computed over exactly what was sent: parse-then-restringify
// changes key order and whitespace, and the signature stops matching.
const ringKey = process.env['RING_HMAC_KEY'] ?? '';
const ringHousehold = process.env['RING_HOUSEHOLD_ID'] ?? 'h_margaret';
app.post(
  '/ring/webhook',
  express.raw({ type: '*/*', limit: '256kb' }),
  createRingWebhook({ store, hmacKey: ringKey, householdId: ringHousehold, ...(now ? { now } : {}) }),
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// --- OAuth 2.1 + PKCE -----------------------------------------------------
// Enabled by setting a signing secret. Without one the endpoints are absent
// rather than present-and-insecure: a half-configured auth server is worse than
// no auth server, because it looks like protection.
const oauthSecret = process.env['CARECIRCLE_OAUTH_SECRET'] ?? '';
if (oauthSecret) {
  const oauth = new OAuthProvider({
    secret: oauthSecret,
    issuer: (process.env['CARECIRCLE_PUBLIC_URL'] ?? 'http://localhost:8787').replace(/\/$/, ''),
    members: () => store.allMembers().map((m) => ({ id: m.id, name: m.spokenAs ?? m.name })),
    allowedRedirects: (process.env['CARECIRCLE_OAUTH_REDIRECTS'] ?? '')
      .split(',').map((u) => u.trim()).filter(Boolean),
    ...(now ? { now } : {}),
  });
  // RFC 9728 - how an MCP client finds the authorization server for this resource.
  app.get('/.well-known/oauth-protected-resource', oauth.protectedResource);
  app.get('/.well-known/oauth-authorization-server', oauth.metadata);
  app.get('/oauth/authorize', oauth.authorize);
  app.post('/oauth/token', oauth.token);
}

// One operational access line per request. Deliberately no body and no query: the
// request carries PHI (medication names, notes) and it must never reach the logs.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    log.info('request', {
      method: req.method, path: req.path, status: res.statusCode,
      ms: Date.now() - started, session: req.header('mcp-session-id') ?? undefined,
    });
  });
  next();
});

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

// The effective actor: a member id, or a bootstrap principal (`bootstrap:<subject>`)
// that may only create its first household. Everything downstream is attributed to
// whichever this returns, and the credential must keep resolving to the same one for
// the life of the session.
const actorFor = (req: express.Request): string | null => {
  const member = resolver.resolve(req);
  if (member) return member;
  const principal = resolver.principal(req);
  return principal ? `${BOOTSTRAP_PREFIX}${principal}` : null;
};

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

  const server = createCareCircleServer({ store, actorId, notifier: messenger, ...(now ? { now } : {}) });
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

  // Last-resort error handler: never leak a stack to the client, and keep the shape
  // JSON-RPC so an MCP client sees a well-formed error. The detail goes to the logs.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('unhandled request error', { reason: err.message });
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
  });

  return app;
}
