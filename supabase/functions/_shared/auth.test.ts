import { exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6.1.0';
import { createAuthenticator } from './auth.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const playerId = '11111111-1111-4111-8111-111111111111';
const issuerPath = '/auth/v1';

async function withJwks(
  run: (baseUrl: string, privateKey: CryptoKey | JsonWebKey, publicJwk: JsonWebKey) => Promise<void>,
) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'latency-test-key';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';

  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => {
      if (new URL(request.url).pathname !== '/auth/v1/.well-known/jwks.json')
        return new Response('not found', { status: 404 });
      return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'public, max-age=600' } });
    },
  );
  try {
    await run(`http://127.0.0.1:${server.addr.port}`, privateKey, publicJwk);
  } finally {
    await server.shutdown();
  }
}

async function signedToken(
  baseUrl: string,
  privateKey: CryptoKey | JsonWebKey,
  claims: Record<string, unknown> = { role: 'authenticated', is_anonymous: true },
  options: { expiresIn?: string; kid?: string; alg?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const alg = options.alg ?? 'ES256';
  const header: Record<string, string> = { alg };
  if (options.kid !== '') header.kid = options.kid ?? 'latency-test-key';
  return await new SignJWT(claims)
    .setProtectedHeader(header)
    .setIssuer(`${baseUrl}${issuerPath}`)
    .setAudience('authenticated')
    .setSubject(playerId)
    .setIssuedAt(now - 120)
    .setExpirationTime(options.expiresIn ?? now + 300)
    .sign(privateKey as CryptoKey);
}

Deno.test('locally verifies a valid asymmetric anonymous token without an Auth API lookup', async () => {
  await withJwks(async (baseUrl, privateKey) => {
    let lookups = 0;
    const authenticate = createAuthenticator(baseUrl, async () => {
      lookups++;
      return null;
    });
    const token = await signedToken(baseUrl, privateKey);
    const identity = await authenticate(token);
    assertEquals(identity?.id, playerId, 'subject');
    assertEquals(identity?.isAnonymous, true, 'anonymous claim');
    assertEquals(lookups, 0, 'Auth API fallback calls');
  });
});

Deno.test('preserves a signed permanent-user identity for administrator checks', async () => {
  await withJwks(async (baseUrl, privateKey) => {
    const authenticate = createAuthenticator(baseUrl, async () => null);
    const token = await signedToken(baseUrl, privateKey, { role: 'authenticated', is_anonymous: false });
    const identity = await authenticate(token);
    assertEquals(identity?.isAnonymous, false, 'permanent-user claim');
  });
});

Deno.test('rejects an invalid asymmetric signature without falling back to Auth', async () => {
  await withJwks(async (baseUrl) => {
    const other = await generateKeyPair('ES256');
    let lookups = 0;
    const authenticate = createAuthenticator(baseUrl, async () => {
      lookups++;
      return { id: playerId, isAnonymous: true };
    });
    const token = await signedToken(baseUrl, other.privateKey);
    assertEquals(await authenticate(token), null, 'invalid signature result');
    assertEquals(lookups, 0, 'invalid-token fallback calls');
  });
});

Deno.test('rejects expired asymmetric tokens without falling back to Auth', async () => {
  await withJwks(async (baseUrl, privateKey) => {
    let lookups = 0;
    const authenticate = createAuthenticator(baseUrl, async () => {
      lookups++;
      return null;
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'authenticated', is_anonymous: true })
      .setProtectedHeader({ alg: 'ES256', kid: 'latency-test-key' })
      .setIssuer(`${baseUrl}${issuerPath}`)
      .setAudience('authenticated')
      .setSubject(playerId)
      .setIssuedAt(now - 300)
      .setExpirationTime(now - 60)
      .sign(privateKey as CryptoKey);
    assertEquals(await authenticate(token), null, 'expired token result');
    assertEquals(lookups, 0, 'expired-token fallback calls');
  });
});

Deno.test('uses Auth.getUser for legacy HS256 tokens', async () => {
  await withJwks(async (baseUrl) => {
    const secret = new TextEncoder().encode('legacy-test-secret-that-is-only-used-in-tests');
    const token = await new SignJWT({ role: 'authenticated', is_anonymous: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(`${baseUrl}${issuerPath}`)
      .setAudience('authenticated')
      .setSubject(playerId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);
    let lookups = 0;
    const authenticate = createAuthenticator(baseUrl, async () => {
      lookups++;
      return { id: playerId, isAnonymous: true };
    });
    assertEquals((await authenticate(token))?.id, playerId, 'legacy token identity');
    assertEquals(lookups, 1, 'legacy fallback calls');
  });
});

Deno.test('falls back for a valid token without the is_anonymous claim rather than guessing', async () => {
  await withJwks(async (baseUrl, privateKey) => {
    let lookups = 0;
    const authenticate = createAuthenticator(baseUrl, async () => {
      lookups++;
      return { id: playerId, isAnonymous: false };
    });
    const token = await signedToken(baseUrl, privateKey, { role: 'authenticated' });
    assertEquals((await authenticate(token))?.isAnonymous, false, 'fallback identity');
    assertEquals(lookups, 1, 'claim compatibility fallback calls');
  });
});
