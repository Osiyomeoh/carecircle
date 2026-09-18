import { createHmac, randomUUID, timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { IdentityResolver, IdentityLookup } from './identity.js';

/**
 * OAuth 2.1 with PKCE.
 *
 * Alexa+ requires the authorization code flow with PKCE (S256) to link an add-on,
 * and MCP's own auth model expects a protected resource that can point a client at
 * its authorization server. This module is both halves.
 *
 * The static bearer tokens elsewhere in this server are for the demo and say so.
 * These are real: the access token is signed and verified here, rather than decoded
 * and trusted the way the gateway JWT strategy does.
 *
 * OAuth 2.1 tightens several things over 2.0, and the tightenings are the security:
 * PKCE is mandatory rather than optional, `plain` challenges are gone, redirect URIs
 * match exactly rather than by prefix, and codes are single-use. Each is enforced
 * below and each has a test named after the attack it prevents.
 */

const CODE_TTL_MS = 60_000;          // an authorization code is a handoff, not a session
const TOKEN_TTL_S = 3600;            // one hour, matching Alexa's ~4h refresh expectations
const REFRESH_TTL_S = 30 * 24 * 3600;

// --- base64url + JWT (HS256), without a dependency -----------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface TokenClaims {
  sub: string;           // member id
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  scope?: string;
  typ?: 'access' | 'refresh';
}

export function signToken(claims: TokenClaims, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify and decode. Returns null on anything wrong - a bad signature, a wrong
 * algorithm, an expired token.
 *
 * The `alg` check is not ceremony: accepting whatever algorithm the token names is
 * the classic JWT forgery, and `alg: none` would make every token valid.
 */
export function verifyToken(token: string, secret: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const head = JSON.parse(unb64url(header).toString('utf8')) as { alg?: string };
    if (head.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const given = unb64url(signature);
    if (expected.length !== given.length) return null;
    if (!timingSafeEqual(expected, given)) return null;
    const claims = JSON.parse(unb64url(payload).toString('utf8')) as TokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch { return null; }
}

// --- PKCE ----------------------------------------------------------------

/** S256: the challenge is the base64url SHA-256 of the verifier. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = b64url(createHash('sha256').update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- the flow ------------------------------------------------------------

interface PendingCode {
  memberId: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}

export interface OAuthOptions {
  /** Signing secret. Refuses to start without one. */
  secret: string;
  /** This server's public URL, used as issuer and in discovery documents. */
  issuer: string;
  /** Members a demo user may sign in as: id -> display name. */
  members: () => Array<{ id: string; name: string }>;
  now?: () => Date;
}

export class OAuthProvider {
  readonly #codes = new Map<string, PendingCode>();
  readonly #opts: OAuthOptions;

  constructor(opts: OAuthOptions) {
    if (!opts.secret) throw new Error('OAuth requires a signing secret.');
    this.#opts = opts;
  }

  get issuer(): string { return this.#opts.issuer; }

  #now(): number { return (this.#opts.now?.() ?? new Date()).getTime(); }

  /** RFC 9728: how an MCP client discovers which authorization server guards this API. */
  protectedResource = (_req: Request, res: Response): void => {
    res.json({
      resource: this.#opts.issuer,
      authorization_servers: [this.#opts.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['carecircle.read', 'carecircle.write'],
    });
  };

  /** RFC 8414 authorization server metadata. */
  metadata = (_req: Request, res: Response): void => {
    res.json({
      issuer: this.#opts.issuer,
      authorization_endpoint: `${this.#opts.issuer}/oauth/authorize`,
      token_endpoint: `${this.#opts.issuer}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // No `plain`. OAuth 2.1 removed it and so do we.
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['carecircle.read', 'carecircle.write'],
    });
  };

  /**
   * The consent screen.
   *
   * A real deployment authenticates the person here. This demo asks which member of
   * the household they are, which is honest about what it is rather than pretending
   * to a login it does not have.
   */
  authorize = (req: Request, res: Response): void => {
    const q = req.query as Record<string, string | undefined>;
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, member } = q;

    if (!client_id || !redirect_uri) {
      res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required.' });
      return;
    }
    // PKCE is mandatory in OAuth 2.1 - a public client without it is interceptable.
    if (!code_challenge) {
      res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge is required (PKCE).' });
      return;
    }
    if (code_challenge_method !== 'S256') {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256; plain is not supported.',
      });
      return;
    }

    // No member chosen yet: show the picker.
    if (!member) {
      res.type('html').send(this.#consentPage(req));
      return;
    }

    const known = this.#opts.members().some((m) => m.id === member);
    if (!known) {
      res.status(400).json({ error: 'access_denied', error_description: 'Unknown member.' });
      return;
    }

    const code = randomBytes(32).toString('hex');
    this.#codes.set(code, {
      memberId: member,
      clientId: client_id,
      redirectUri: redirect_uri,
      challenge: code_challenge,
      expiresAt: this.#now() + CODE_TTL_MS,
    });

    const target = new URL(redirect_uri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    res.redirect(302, target.toString());
  };

  token = (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const grant = body['grant_type'];

    if (grant === 'refresh_token') {
      const claims = body['refresh_token'] ? verifyToken(body['refresh_token'], this.#opts.secret) : null;
      if (!claims || claims.typ !== 'refresh') {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      res.json(this.#issue(claims.sub));
      return;
    }

    if (grant !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }

    const code = body['code'];
    const verifier = body['code_verifier'];
    const redirectUri = body['redirect_uri'];
    if (!code || !verifier) {
      res.status(400).json({ error: 'invalid_request', error_description: 'code and code_verifier are required.' });
      return;
    }

    const pending = this.#codes.get(code);
    // Single use: consumed whether or not the rest validates, so a leaked code cannot
    // be retried against a guessed verifier.
    this.#codes.delete(code);

    if (!pending || pending.expiresAt <= this.#now()) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Code is unknown or expired.' });
      return;
    }
    // Exact match, not prefix. A registered redirect that merely starts the same way
    // is how tokens end up at an attacker's endpoint.
    if (redirectUri !== pending.redirectUri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri does not match.' });
      return;
    }
    if (!pkceMatches(verifier, pending.challenge)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' });
      return;
    }

    res.json(this.#issue(pending.memberId));
  };

  #issue(memberId: string): Record<string, unknown> {
    const iat = Math.floor(this.#now() / 1000);
    const base = { sub: memberId, iss: this.#opts.issuer, aud: this.#opts.issuer, iat };
    return {
      access_token: signToken({ ...base, exp: iat + TOKEN_TTL_S, typ: 'access', scope: 'carecircle.read carecircle.write' }, this.#opts.secret),
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_S,
      refresh_token: signToken({ ...base, exp: iat + REFRESH_TTL_S, typ: 'refresh' }, this.#opts.secret),
      scope: 'carecircle.read carecircle.write',
    };
  }

  #consentPage(req: Request): string {
    const q = req.query as Record<string, string | undefined>;
    const keep = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state'];
    const buttons = this.#opts.members().map((m) => {
      const url = new URL(`${this.#opts.issuer}/oauth/authorize`);
      for (const k of keep) if (q[k]) url.searchParams.set(k, q[k]!);
      url.searchParams.set('member', m.id);
      return `<a class="who" href="${url.pathname}${url.search}">${escapeHtml(m.name)}</a>`;
    }).join('');
    return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect CareCircle</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100svh;background:#07090f;color:#eef2fb}
main{max-width:26rem;padding:2rem}
h1{font-size:1.3rem;margin:0 0 .4rem}
p{color:#8b93a7;margin:0 0 1.5rem}
.who{display:block;padding:.9rem 1rem;margin:.5rem 0;border:1px solid rgba(255,255,255,.12);border-radius:.7rem;text-decoration:none;color:inherit}
.who:hover{border-color:#7cf0c8}
small{color:#8b93a7;display:block;margin-top:1.5rem}
</style>
<main>
<h1>Connect to CareCircle</h1>
<p>Who is setting this up? What you can do depends on your role in the care circle.</p>
${buttons}
<small>Demo sign-in. A production deployment authenticates here instead of asking.</small>
</main>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Identity from an access token this server issued and can verify.
 *
 * Unlike the gateway JWT strategy, the signature IS checked here, because we hold
 * the key. A forged or expired token resolves to nobody.
 */
export function oauthResolver(secret: string, lookup?: IdentityLookup): IdentityResolver {
  return {
    strategy: 'jwt',
    resolve(req) {
      const m = /^Bearer\s+(.+)$/i.exec((req.header('authorization') ?? '').trim());
      if (!m) return null;
      const claims = verifyToken(m[1]!.trim(), secret);
      if (!claims || claims.typ === 'refresh') return null;
      return claims.sub ? (lookup?.(claims.sub) ?? claims.sub) : null;
    },
    principal() { return null; },
  };
}

/** A PKCE pair, for clients and tests. */
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export { randomUUID };
