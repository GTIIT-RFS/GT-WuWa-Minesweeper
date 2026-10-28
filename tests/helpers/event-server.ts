import { test as base, expect, type Page } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  newOnlineGame,
  type Round,
  type RoundRepository,
} from '../../supabase/functions/_shared/competition';
import { createCompetitionHandler, type Identity } from '../../supabase/functions/_shared/http';
import type { EventRepository } from '../../supabase/functions/_shared/event-types';
export async function createEventServer(page: Page) {
  const db = new PGlite();
  const adminId = '33333333-3333-4333-8333-333333333333';
  let now = Date.parse('2030-06-01T10:10:00Z');
  let signupCount = 0;
  let playerId: string | null = null;
  let dropMove = false;
  let overviewFailed = false;
  let overviewReads = 0;
  let nonAdminLogin = false;
  const tokens = new Map<string, Identity>();
  async function rows<T = Record<string, unknown>>(sql: string, args: unknown[] = []) {
    return (await db.query<T>(sql, args)).rows;
  }
  async function rpc<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
    return (
      await rows<{ value: T }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`,
        args.map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : x)),
      )
    )[0].value;
  }
  async function setTime(value: string | number) {
    now = typeof value === 'string' ? Date.parse(value) : value;
    await db.exec(
      `create or replace function public.event_clock() returns timestamptz language sql volatile as $$select '${new Date(now).toISOString()}'::timestamptz$$`,
    );
  }
  await db.exec(
    `create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null default true);create role anon;create role authenticated;create role service_role bypassrls;insert into auth.users values('${adminId}',false);`,
  );
  for (const file of readdirSync('supabase/migrations')
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await setTime('2030-06-01T09:00:00Z');
  await db.query('insert into public.event_admins values($1)', [adminId]);
  await rpc('event_admin_action', [adminId, randomUUID(), 'configure', { date: '2030-06-01' }]);
  await setTime('2030-06-01T10:10:00Z');
  const games: RoundRepository = {
    start: (player, name, state) => rpc<Round>('start_online_round', [player, name, state]),
    get: (id, player) => rpc<Round | null>('event_get_round', [id, player]),
    commit: (round, state, request) =>
      rpc<Round>('commit_online_move', [round.id, round.player_id, round.revision, state, request]),
  };
  const testGames: RoundRepository = {
    start: (player, name, state) => rpc<Round>('event_test_start', [player, name, state]),
    get: (id, player) => rpc<Round | null>('event_get_round', [id, player]),
    commit: (round, state, request) =>
      rpc<Round>('event_test_commit', [round.id, round.player_id, round.revision, state, request]),
  };
  const events: EventRepository = {
    overview: (player) => rpc('event_overview', [player]),
    board: (kind, stage, player, page) => rpc('event_board', [kind, stage, player, page]),
    awards: (player) => rpc('event_my_awards', [player]),
    adminRead: (player, page) => rpc('event_admin_read', [player, page]),
    adminAction: (player, request, action, payload) =>
      rpc('event_admin_action', [player, request, action, payload]),
    testOverview: (player) => rpc('event_test_overview', [player]),
    testBoard: (kind, stage, player, page) => rpc('event_test_board', [kind, stage, player, page]),
    testAwards: (player) => rpc('event_test_awards', [player]),
    testAdminSettle: (player, request) => rpc('event_test_admin_settle', [player, request]),
    testAdminAction: (player, request, action, payload) =>
      rpc('event_test_admin_action', [player, request, action, payload]),
  };
  const handler = createCompetitionHandler(
    async (token) => tokens.get(token) ?? null,
    games,
    () => 0,
    events,
    testGames,
  );
  function session(id: string, isAnonymous: boolean) {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const access_token = `test.${Buffer.from(JSON.stringify({ exp: expires, sub: id })).toString('base64url')}.test`;
    tokens.set(access_token, { id, isAnonymous });
    return {
      access_token,
      refresh_token: `refresh-${id}`,
      token_type: 'bearer',
      expires_in: 3600,
      user: {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        is_anonymous: isAnonymous,
        email: isAnonymous ? undefined : 'staff@example.com',
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    };
  }
  await page.route('https://wuwa-test.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '{}' });
    if (url.pathname.endsWith('/signup')) {
      expect(request.postDataJSON()).not.toHaveProperty('email');
      playerId = randomUUID();
      signupCount++;
      await db.query('insert into auth.users values($1,true)', [playerId]);
      return route.fulfill({ headers, json: session(playerId, true) });
    }
    if (url.pathname.endsWith('/token')) {
      const id = nonAdminLogin ? randomUUID() : adminId;
      if (nonAdminLogin) await db.query('insert into auth.users values($1,false)', [id]);
      return route.fulfill({ headers, json: session(id, false) });
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ headers, json: {} });
    if (url.pathname.endsWith('/competition')) {
      const body = request.postDataJSON();
      expect(body).not.toHaveProperty('seconds');
      expect(body).not.toHaveProperty('state');
      if (body.action === 'overview') {
        overviewReads++;
        if (overviewFailed)
          return route.fulfill({ status: 503, headers, json: { error: '测试刷新失败' } });
      }
      const response = await handler(
        new Request('https://test/competition', {
          method: 'POST',
          headers: { authorization: request.headers().authorization ?? '' },
          body: request.postData(),
        }),
      );
      if (dropMove && body.action === 'move') {
        dropMove = false;
        return route.abort('failed');
      }
      return route.fulfill({
        status: response.status,
        headers: { ...headers, ...Object.fromEntries(response.headers) },
        body: await response.text(),
      });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'Unexpected test endpoint' } });
  });
  async function seedWin(name: string, elapsed = 2000, owner?: string, roundNo = 1) {
    const id = owner ?? randomUUID();
    if (!owner) await db.query('insert into auth.users values($1,true)', [id]);
    const stage = (
      await rows<{ id: string; starts_at: string }>(
        "select id,starts_at from public.event_stages where competition_id='club-night-v1' and round_no=$1",
        [roundNo],
      )
    )[0];
    const achieved = Math.max(Date.parse(stage.starts_at) + elapsed + 1000, now);
    const gameId = randomUUID();
    const winId = randomUUID();
    // Trusted leaderboard fixture only. The playable workflow tests below use the real HTTP engine.
    await db.query(
      `insert into public.online_rounds(id,competition_id,player_id,display_name,state,stage_id,started_at,finished_at) values($1,'club-night-v1',$2,$3,$4,$5,$6,$7)`,
      [
        gameId,
        id,
        name,
        JSON.stringify({ ...newOnlineGame(), status: 'won' }),
        stage.id,
        new Date(achieved - elapsed).toISOString(),
        new Date(achieved).toISOString(),
      ],
    );
    await db.query(
      'insert into public.event_wins(id,game_id,stage_id,player_id,display_name,elapsed_ms,achieved_at) values($1,$2,$3,$4,$5,$6,$7)',
      [winId, gameId, stage.id, id, name, elapsed, new Date(achieved).toISOString()],
    );
    await db.query('insert into public.event_bests values($1,$2,$3,$4,$5,$6)', [
      stage.id,
      id,
      winId,
      name,
      elapsed,
      new Date(achieved).toISOString(),
    ]);
    return id;
  }
  return {
    db,
    rows,
    rpc,
    setTime,
    advance: (ms: number) => setTime(now + ms),
    seedWin,
    close: () => db.close(),
    dropNextMove: () => {
      dropMove = true;
    },
    failOverview: (value: boolean) => {
      overviewFailed = value;
    },
    getOverviewReads: () => overviewReads,
    getSignupCount: () => signupCount,
    getPlayer: () => playerId,
    nonAdminStaff: () => {
      nonAdminLogin = true;
    },
  };
}
export type EventServer = Awaited<ReturnType<typeof createEventServer>>;
export const test = base.extend<{ eventServer: EventServer }>({
  eventServer: async ({ page }, use) => {
    const server = await createEventServer(page);
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
});
export { expect };
