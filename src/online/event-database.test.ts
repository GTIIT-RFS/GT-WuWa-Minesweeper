import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { newOnlineGame } from '../../supabase/functions/_shared/competition';
const db = new PGlite();
const player = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function rpc<T = Record<string, unknown>>(name: string, params: unknown[] = []): Promise<T> {
  return (
    await rows<{ value: T }>(
      `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) as value`,
      params.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : x)),
    )
  )[0].value;
}
async function clock(iso: string) {
  await db.exec(
    `create or replace function public.event_clock() returns timestamptz language sql volatile as $$select '${iso}'::timestamptz$$`,
  );
}
async function adminAction(
  action: string,
  payload: unknown,
  actor = admin,
  request = randomUUID(),
) {
  return rpc('event_admin_action', [actor, request, action, payload]);
}
async function start(who = player, name = '土豆') {
  return rpc<{
    id: string;
    revision: number;
    stage_id: string;
    state: ReturnType<typeof newOnlineGame>;
  }>('start_online_round', [who, name, newOnlineGame()]);
}
async function finish(game: Awaited<ReturnType<typeof start>>, who = player, status = 'won') {
  return rpc<{ state: { status: string } }>('commit_online_move', [
    game.id,
    who,
    game.revision,
    { ...game.state, status },
    randomUUID(),
  ]);
}

beforeAll(async () => {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,is_anonymous boolean not null default true); create role anon; create role authenticated; create role service_role bypassrls;
    insert into auth.users values ('${player}',true),('${other}',true),('${admin}',false);`);
  for (const file of readdirSync('supabase/migrations')
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await clock('2030-06-01T09:00:00Z');
}, 30000);
afterAll(() => db.close());
it('installs an additive upgrade and keeps the event closed until a date is configured', async () => {
  expect(await rows('select * from public.online_competitions')).toHaveLength(1);
  await expect(start()).rejects.toThrow(/event not open/);
  await db.query('insert into public.event_admins(user_id) values ($1)', [admin]);
  await adminAction('configure', { date: '2030-06-01' });
  const stages = await rows<{ starts_at: string; ends_at: string }>(
    'select * from public.event_stages order by round_no',
  );
  expect(stages).toHaveLength(4);
  expect(new Date(stages[0].starts_at).toISOString()).toBe('2030-06-01T10:00:00.000Z');
  expect(new Date(stages[3].ends_at).toISOString()).toBe('2030-06-01T14:00:00.000Z');
});
it('enforces 18:00 open and 18:57 new-game cutoff using the database clock', async () => {
  await clock('2030-06-01T09:59:59.999Z');
  await expect(start()).rejects.toThrow(/event not open/);
  await clock('2030-06-01T10:00:00Z');
  const game = await start();
  expect(game.stage_id).toBeTruthy();
  await clock('2030-06-01T10:00:10Z');
  await finish(game);
  await clock('2030-06-01T10:56:59.999Z');
  const last = await start();
  await clock('2030-06-01T10:57:00Z');
  expect((await start()).id).toBe(last.id);
  await expect(start(other)).rejects.toThrow(/new games closed/);
  await clock('2030-06-01T10:57:10Z');
  await finish(last);
  expect(await rows('select * from public.event_wins')).toHaveLength(2);
});
