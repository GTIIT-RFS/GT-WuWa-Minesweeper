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
  };
  const games: RoundRepository = { start: vi.fn(), get: vi.fn(), commit: vi.fn() };
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
  );
  const post = (body: object, token?: string) =>
    handler(
      new Request('https://example.com/competition', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    );
  return { post, events, games };
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
