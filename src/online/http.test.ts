import { expect, it, vi } from 'vitest';
import { createCompetitionHandler } from '../../supabase/functions/_shared/http';
import {
  ApiError,
  newOnlineGame,
  type RoundRepository,
} from '../../supabase/functions/_shared/competition';

function setup() {
  const repository: RoundRepository = {
    start: vi.fn(async (player_id, display_name, state) => ({
      id: 'test',
      player_id,
      display_name,
      state,
      revision: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
      competition_id: 'club-night-v1',
      last_request_id: null,
    })),
    get: vi.fn(async () => null),
    commit: vi.fn(),
  };
  const handler = createCompetitionHandler(
    async (token) => (token === 'valid-email-session' ? 'verified-player' : null),
    repository,
    () => 0,
  );
  const post = (body: string, token = 'valid-email-session') =>
    handler(
      new Request('https://example.com/competition', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      }),
    );
  return { repository, handler, post };
}
it('rejects missing or forged authentication before accessing the repository', async () => {
  const { post, repository, handler } = setup();
  expect((await post('{}', 'forged-token')).status).toBe(401);
  expect(
    (await handler(new Request('https://example.com', { method: 'POST', body: '{}' }))).status,
  ).toBe(401);
  expect(repository.start).not.toHaveBeenCalled();
  expect(repository.get).not.toHaveBeenCalled();
});
it('accepts CORS preflight, rejects wrong methods, oversized and malformed bodies', async () => {
  const { post, handler } = setup();
  const preflight = await handler(new Request('https://example.com', { method: 'OPTIONS' }));
  expect(preflight.status).toBe(200);
  expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
  expect((await handler(new Request('https://example.com'))).status).toBe(405);
  expect((await post('x'.repeat(2049))).status).toBe(413);
  for (const body of ['bad-json', 'null', '[]', '{}']) expect((await post(body)).status).toBe(400);
});
it('uses verified identity and server-created board, ignoring forged score, identity and time', async () => {
  const { post, repository } = setup();
  const response = await post(
    JSON.stringify({
      action: 'start',
      name: '土豆',
      player: 'victim',
      state: { status: 'won' },
      seconds: 0,
    }),
  );
  expect(response.status).toBe(200);
  expect(repository.start).toHaveBeenCalledWith('verified-player', '土豆', newOnlineGame());
  const body = await response.json();
  expect(body).not.toHaveProperty('player_id');
  expect(body.game.status).toBe('ready');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('returns safe errors without disclosing database or credential details', async () => {
  const { post, repository } = setup();
  vi.mocked(repository.start).mockRejectedValueOnce(new Error('internal-private-value'));
  const failed = await post('{"action":"start","name":"土豆"}');
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('internal-private-value');
  vi.mocked(repository.start).mockRejectedValueOnce(new ApiError(429, '请稍后重试'));
  expect((await post('{"action":"start","name":"土豆"}')).status).toBe(429);
});
