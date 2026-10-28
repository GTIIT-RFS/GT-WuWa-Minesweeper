import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from 'npm:jose@6.1.0';

export interface VerifiedIdentity {
  id: string;
  isAnonymous: boolean;
}

type UserLookup = (token: string) => Promise<VerifiedIdentity | null>;

const algorithms = ['ES256', 'RS256', 'EdDSA'] as const;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isJwksInfrastructureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof candidate.code === 'string' && candidate.code.startsWith('ERR_JWKS_')) return true;
  if (
    typeof candidate.name === 'string' &&
    /^(JWKSTimeout|JWKSNoMatchingKey|JWKSInvalid)$/.test(candidate.name)
  ) {
    return true;
  }
  return (
    error instanceof TypeError &&
    /fetch|network|timeout/i.test(String(candidate.message ?? ''))
  );
}

/**
 * Prefer locally verified asymmetric access tokens. The remote JWKS resolver caches keys
 * within the Edge Function isolate. Legacy HS256 tokens and JWKS infrastructure failures
 * use Auth.getUser as a compatibility fallback; invalid signatures/claims fail closed.
 */
export function createAuthenticator(
  supabaseUrl: string,
  lookupUser: UserLookup,
): (
  token: string,
  options?: { requireCurrentUser?: boolean },
) => Promise<VerifiedIdentity | null> {
  const baseUrl = new URL(supabaseUrl);
  const issuer = new URL('/auth/v1', baseUrl).toString();
  const jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', baseUrl));

  return async (
    token: string,
    options?: { requireCurrentUser?: boolean },
  ): Promise<VerifiedIdentity | null> => {
    if (options?.requireCurrentUser) return lookupUser(token);

    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      return null;
    }

    // Supabase projects using the legacy shared JWT secret cannot publish that secret as JWKS.
    if (header.alg === 'HS256') return lookupUser(token);
    if (
      typeof header.alg !== 'string' ||
      !algorithms.includes(header.alg as (typeof algorithms)[number]) ||
      typeof header.kid !== 'string' ||
      !header.kid
    ) {
      return null;
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: 'authenticated',
        algorithms: [...algorithms],
      }));
    } catch (error) {
      if (isJwksInfrastructureError(error)) return lookupUser(token);
      return null;
    }

    if (
      typeof payload.sub !== 'string' ||
      !userIdPattern.test(payload.sub) ||
      payload.role !== 'authenticated'
    ) {
      return null;
    }

    // Older access tokens may omit this claim. Resolve those with Auth rather than guessing.
    if (typeof payload.is_anonymous !== 'boolean') return lookupUser(token);

    return { id: payload.sub, isAnonymous: payload.is_anonymous };
  };
}
