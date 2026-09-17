import type { Request } from 'express';

/**
 * Who is speaking.
 *
 * CareCircle assigns responsibility for someone's medical care, so identity is
 * established by the credential on the request and never by anything said in the
 * conversation. Two strategies, one interface:
 *
 * - `static`   a token -> member map. Local development and the demo.
 * - `jwt`      claims from a JWT that a trusted gateway has already validated.
 *
 * The JWT strategy deliberately does NOT verify the signature. That is only safe
 * behind a gateway that has already done so — Bedrock AgentCore validates inbound
 * JWTs against the configured authorizer before forwarding the request — so it is
 * gated behind an explicit opt-in rather than inferred from the environment.
 * Turning it on for a directly-exposed server would let anyone assert any identity.
 */

export interface IdentityResolver {
  /** The member id this request acts as, or null when it cannot be established. */
  resolve(req: Request): string | null;
  /**
   * The authenticated subject when the caller is known but not yet a member of any
   * care circle — the seam that lets a new household be created (`create_household`).
   * Returns null when there is no such principal, so an ordinary request cannot
   * bootstrap by accident. In production (JWT) this is any validated subject; in
   * static/demo it is opt-in via CARECIRCLE_ALLOW_SELF_SIGNUP so the demo server's
   * behaviour is unchanged by default.
   */
  principal(req: Request): string | null;
  readonly strategy: 'static' | 'jwt';
}

/** Optional fallback that resolves a subject to a member from persisted mappings. */
export type IdentityLookup = (subject: string) => string | null;

/**
 * A session for an authenticated-but-unmapped caller is bound to this pseudo-actor.
 * It can only create its first household; every other tool sees "not a member yet".
 */
export const BOOTSTRAP_PREFIX = 'bootstrap:';

/** The subject behind a bootstrap actor id, or null for an ordinary member. */
export function bootstrapSubject(actorId: string): string | null {
  return actorId.startsWith(BOOTSTRAP_PREFIX) ? actorId.slice(BOOTSTRAP_PREFIX.length) : null;
}

function bearer(req: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((req.header('authorization') ?? '').trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Development and demo: opaque tokens mapped to members, plus a persisted fallback.
 * `selfSignup` decides whether an unknown token is a bootstrap principal; when
 * omitted it follows CARECIRCLE_ALLOW_SELF_SIGNUP, so production stays env-driven
 * while tests can be explicit and isolated.
 */
export function staticTokens(
  tokens: Map<string, string>, lookup?: IdentityLookup, selfSignup?: boolean,
): IdentityResolver {
  const allowSignup = selfSignup ?? (process.env['CARECIRCLE_ALLOW_SELF_SIGNUP'] === 'true');
  return {
    strategy: 'static',
    resolve(req) {
      const token = bearer(req);
      if (!token) return null;
      // Seeded demo tokens first, then members provisioned at runtime.
      return tokens.get(token) ?? lookup?.(token) ?? null;
    },
    principal(req) {
      if (!allowSignup) return null;
      const token = bearer(req);
      // A token that resolves to a member is not a bootstrap principal.
      if (!token || tokens.get(token) || lookup?.(token)) return null;
      return token;
    },
  };
}

/** Decode a JWT payload without verifying it. Only valid behind a trusted gateway. */
function decodeClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      .toString('utf8');
    const claims = JSON.parse(payload) as Record<string, unknown>;
    // Even behind a validating gateway, an expired token should not be honoured.
    const exp = typeof claims['exp'] === 'number' ? claims['exp'] : null;
    if (exp !== null && exp * 1000 < Date.now()) return null;
    return claims;
  } catch { return null; }
}

export interface JwtIdentityOptions {
  /** Claim naming the member, e.g. 'sub' or 'custom:carecircle_member'. */
  claim: string;
  /** Claim value -> member id. A subject with no mapping is not a member. */
  members: Map<string, string>;
  /** Persisted subject -> member fallback, for members provisioned at runtime. */
  lookup?: IdentityLookup;
  /** Whether a validated-but-unmapped subject may bootstrap a household. Off unless
   *  explicitly enabled, so switching to JWT identity does not silently allow anyone
   *  behind the gateway to self-provision. */
  selfSignup?: boolean;
}

/**
 * Production: a member is whoever the validated token says they are.
 *
 * An unmapped subject resolves to null rather than being admitted as a stranger:
 * being authenticated is not the same as belonging to this care circle. But a
 * validated-yet-unmapped subject IS a bootstrap `principal` — it may create a new
 * household and, in doing so, become that household's first member.
 */
export function jwtClaims({ claim, members, lookup, selfSignup }: JwtIdentityOptions): IdentityResolver {
  const subjectOf = (req: Request): string | null => {
    const token = bearer(req);
    if (!token) return null;
    const value = decodeClaims(token)?.[claim];
    return typeof value === 'string' ? value : null;
  };
  return {
    strategy: 'jwt',
    resolve(req) {
      const subject = subjectOf(req);
      if (!subject) return null;
      return members.get(subject) ?? lookup?.(subject) ?? null;
    },
    principal(req) {
      if (!selfSignup) return null;
      const subject = subjectOf(req);
      // Authenticated but not yet a member of any circle.
      if (!subject || members.get(subject) || lookup?.(subject)) return null;
      return subject;
    },
  };
}

/**
 * Choose a resolver from the environment.
 *
 * `CARECIRCLE_JWT_CLAIM` opts in to the JWT strategy and is the only way to enable
 * it — see the warning above. `CARECIRCLE_MEMBER_MAP` is JSON mapping claim values
 * to member ids.
 */
export function resolverFromEnv(fallbackTokens: Map<string, string>, lookup?: IdentityLookup): IdentityResolver {
  const claim = process.env['CARECIRCLE_JWT_CLAIM'];
  if (!claim) return staticTokens(fallbackTokens, lookup);
  const raw = process.env['CARECIRCLE_MEMBER_MAP'] ?? '{}';
  let members: Map<string, string>;
  try {
    members = new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    throw new Error('CARECIRCLE_MEMBER_MAP is not valid JSON; refusing to start with an unusable identity map.');
  }
  // An empty env map is only viable if self-signup is on, so a validated-but-unmapped
  // principal can bootstrap the first household. Without either, nobody could ever
  // authenticate — refuse to start rather than boot a server no one can use.
  const selfSignup = process.env['CARECIRCLE_ALLOW_SELF_SIGNUP'] === 'true';
  if (members.size === 0 && !selfSignup) {
    throw new Error('CARECIRCLE_JWT_CLAIM is set but CARECIRCLE_MEMBER_MAP is empty and CARECIRCLE_ALLOW_SELF_SIGNUP is not enabled; nobody could authenticate.');
  }
  return jwtClaims({ claim, members, selfSignup, ...(lookup ? { lookup } : {}) });
}
