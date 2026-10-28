import { expect, it, vi } from 'vitest';
import { createCompetitionHandler } from '../../supabase/functions/_shared/http';
import type { EventRepository } from '../../supabase/functions/_shared/event-types';
import type { RoundRepository } from '../../supabase/functions/_shared/competition';
function setup() {
  const events: EventRepository = {
    overview: vi.fn(async () => ({ public: true })),
    board: vi.fn(async () => ({ entries: [] })),
    awards: vi.fn(async () => []),
    adminRead: vi.fn(async () => ({ admin: true })),
    adminAction: vi.fn(async () => ({ ok: true })),
    testOverview: vi.fn(async () => ({ test: true })),
    testBoard: vi.fn(async () => ({ entries: [] })),
    testAwards: vi.fn(async () => []),
    testAdminSettle: vi.fn(async () => ({ ok: true })),
    testAdminAction: vi.fn(async () => ({ ok: true })),
  };
  const games: RoundRepository = { start: vi.fn(), get: vi.fn(), commit: vi.fn() };
  const testGames: RoundRepository = {
    start: vi.fn(async (player, name, state) => ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      player_id: player,
      competition_id: 'club-night-test-initial',
      display_name: name,
      state,
      revision: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
      last_request_id: null,
    })),
    get: vi.fn(),
    commit: vi.fn(),
  };
  const handler = createCompetitionHandler(
    async (token) =>
      token === 'anonymous'
        ? { id: 'verified-anon', isAnonymous: true }
        : token === 'staff'
          ? { id: 'verified-staff', isAnonymous: false }
          : null,
    games,
    () => 0,
    events,
    testGames,
  );
  const post = (body: object, token?: string) =>
    handler(
      new Request('https://example.com/competition', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    );
  return { post, events, games, testGames };
}
it('allows spectators to read public results without creating an account', async () => {
  const { post, events } = setup();
  expect((await post({ action: 'overview', userId: 'victim' })).status).toBe(200);
  expect(events.overview).toHaveBeenCalledWith(null);
});
it('binds private awards and personal ranking to the verified anonymous identity', async () => {
  const { post, events } = setup();
  expect((await post({ action: 'awards', userId: 'victim' }, 'anonymous')).status).toBe(200);
  expect(events.awards).toHaveBeenCalledWith('verified-anon');
  await post({ action: 'overview', userId: 'victim' }, 'anonymous');
  expect(events.overview).toHaveBeenCalledWith('verified-anon');
  expect((await post({ action: 'awards' })).status).toBe(401);
  expect((await post({ action: 'awards' }, 'forged')).status).toBe(401);
});
it('rejects anonymous staff operations before invoking privileged repository methods', async () => {
  const { post, events } = setup();
  expect((await post({ action: 'admin_read' }, 'anonymous')).status).toBe(403);
  expect(
    (
      await post(
        {
          action: 'admin_action',
          operation: 'settle',
          payload: {},
          requestId: crypto.randomUUID(),
        },
        'anonymous',
      )
    ).status,
  ).toBe(403);
  expect(events.adminRead).not.toHaveBeenCalled();
  expect(events.adminAction).not.toHaveBeenCalled();
});
it('forwards only verified staff identity and a validated idempotency token', async () => {
  const { post, events } = setup();
  const requestId = crypto.randomUUID();
  expect(
    (
      await post(
        {
          action: 'admin_action',
          operation: 'pause',
          payload: { paused: true },
          requestId,
          userId: 'victim',
        },
        'staff',
      )
    ).status,
  ).toBe(200);
  expect(events.adminAction).toHaveBeenCalledWith('verified-staff', requestId, 'pause', {
    paused: true,
  });
  expect(
    (await post({ action: 'admin_action', operation: 'unknown', payload: {}, requestId }, 'staff'))
      .status,
  ).toBe(400);
});
it('rejects malformed paging and stage IDs before public queries', async () => {
  const { post, events } = setup();
  for (const body of [
    { action: 'overview', page: -1 },
    { action: 'board', kind: 'all', page: 0 },
    { action: 'board', kind: 'history', stageId: 'sql-injection' },
  ])
    expect((await post(body)).status).toBe(400);
  expect(events.board).not.toHaveBeenCalled();
});

it('keeps test results on a separate public API route and requires identity for test games', async () => {
  const { post, events, testGames } = setup();
  expect((await post({ action: 'test_overview', userId: 'victim' })).status).toBe(200);
  expect(events.testOverview).toHaveBeenCalledWith(null);
  expect((await post({ action: 'test_board', kind: 'live' })).status).toBe(200);
  expect(events.testBoard).toHaveBeenCalledWith('live', null, null, 0);
  expect((await post({ action: 'test_start', name: '测试玩家' })).status).toBe(401);
  expect((await post({ action: 'test_start', name: '测试玩家' }, 'anonymous')).status).toBe(200);
  expect(testGames.start).toHaveBeenCalledWith('verified-anon', '测试玩家', expect.any(Object));
  expect((await post({ action: 'test_board', kind: 'invalid' })).status).toBe(400);
});

it('restricts test settlement and test claim actions to verified staff accounts', async () => {
  const { post, events } = setup();
  const requestId = crypto.randomUUID();
  expect((await post({ action: 'test_admin_settle', requestId }, 'anonymous')).status).toBe(403);
  expect((await post({ action: 'test_admin_settle', requestId }, 'staff')).status).toBe(200);
  expect(events.testAdminSettle).toHaveBeenCalledWith('verified-staff', requestId);
  expect(
    (
      await post(
        { action: 'test_admin_action', requestId, operation: 'claim', payload: {} },
        'staff',
      )
    ).status,
  ).toBe(200);
  expect(events.testAdminAction).toHaveBeenCalledWith('verified-staff', requestId, 'claim', {});
  expect(
    (
      await post(
        { action: 'test_admin_action', requestId, operation: 'configure', payload: {} },
        'staff',
      )
    ).status,
  ).toBe(400);
});
