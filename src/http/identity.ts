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
  readonly strategy: 'static' | 'jwt';
}

function bearer(req: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((req.header('authorization') ?? '').trim());
  return match ? match[1]!.trim() : null;
}

/** Development and demo: opaque tokens mapped to members. */
export function staticTokens(tokens: Map<string, string>): IdentityResolver {
  return {
    strategy: 'static',
    resolve(req) {
      const token = bearer(req);
      return token ? tokens.get(token) ?? null : null;
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
}

/**
 * Production: a member is whoever the validated token says they are.
 *
 * An unmapped subject resolves to null rather than being admitted as a stranger:
 * being authenticated is not the same as belonging to this care circle.
 */
export function jwtClaims({ claim, members }: JwtIdentityOptions): IdentityResolver {
  return {
    strategy: 'jwt',
    resolve(req) {
      const token = bearer(req);
      if (!token) return null;
      const claims = decodeClaims(token);
      const value = claims?.[claim];
      return typeof value === 'string' ? members.get(value) ?? null : null;
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
export function resolverFromEnv(fallbackTokens: Map<string, string>): IdentityResolver {
  const claim = process.env['CARECIRCLE_JWT_CLAIM'];
  if (!claim) return staticTokens(fallbackTokens);
  const raw = process.env['CARECIRCLE_MEMBER_MAP'] ?? '{}';
  let members: Map<string, string>;
  try {
    members = new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    throw new Error('CARECIRCLE_MEMBER_MAP is not valid JSON; refusing to start with an unusable identity map.');
  }
  if (members.size === 0) {
    throw new Error('CARECIRCLE_JWT_CLAIM is set but CARECIRCLE_MEMBER_MAP is empty; nobody could authenticate.');
  }
  return jwtClaims({ claim, members });
}
