import { createCompetitionHandler } from './http.ts';
import type { Round, RoundRepository } from './competition.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const playerId = '11111111-1111-4111-8111-111111111111';

const repository: RoundRepository = {
  async start(player, name, state): Promise<Round> {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      player_id: player,
      competition_id: 'club-night-v1',
      display_name: name,
      state,
      revision: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
      last_request_id: null,
    };
  },
  async get(): Promise<Round | null> {
    return null;
  },
  async commit(round): Promise<Round> {
    return round;
  },
};

Deno.test('OPTIONS responses cache preflight and expose timing headers', async () => {
  const handler = createCompetitionHandler(
    async () => null,
    repository,
    () => 0,
  );
  const response = await handler(new Request('https://test/competition', { method: 'OPTIONS' }));
  assert(response.status === 200, 'OPTIONS status must be 200');
  assertEquals(response.headers.get('access-control-max-age'), '600', 'preflight cache duration');
  assert(
    response.headers.get('access-control-expose-headers')?.includes('Server-Timing'),
    'Server-Timing must be exposed to browser clients',
  );
  assert(
    response.headers.get('access-control-expose-headers')?.includes('X-Request-Id'),
    'request id must be exposed to browser clients',
  );
});

Deno.test('POST responses include non-sensitive server timing and a request id', async () => {
  const handler = createCompetitionHandler(
    async (token) => (token === 'verified-test-token' ? { id: playerId, isAnonymous: true } : null),
    repository,
    () => 0,
  );
  const response = await handler(
    new Request('https://test/competition', {
      method: 'POST',
      headers: { authorization: '***', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', name: 'Latency test' }),
    }),
  );
  assert(response.status === 200, 'start status must be 200');
  const timing = response.headers.get('server-timing') ?? '';
  assert(/auth;dur=\d+(\.\d+)?/.test(timing), 'auth timing metric missing');
  assert(/db;dur=\d+(\.\d+)?/.test(timing), 'database timing metric missing');
  assert(/app;dur=\d+(\.\d+)?/.test(timing), 'application timing metric missing');
  assert(/total;dur=\d+(\.\d+)?/.test(timing), 'total timing metric missing');
  assert(
    /^[0-9a-f-]{36}$/i.test(response.headers.get('x-request-id') ?? ''),
    'request id must be a UUID',
  );
});

Deno.test('error responses retain timing diagnostics without exposing token data', async () => {
  const handler = createCompetitionHandler(
    async () => null,
    repository,
    () => 0,
  );
  const response = await handler(
    new Request('https://test/competition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move' }),
    }),
  );
  assert(response.status === 401, 'unauthenticated status must be 401');
  assert(response.headers.has('server-timing'), 'error response timing missing');
  assert(
    !(await response.text()).includes('verified-test-token'),
    'response leaked credential text',
  );
});
