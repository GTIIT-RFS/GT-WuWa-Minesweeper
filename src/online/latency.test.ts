import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createCompetitionHandler } from '../../supabase/functions/_shared/http';
import type { RoundRepository } from '../../supabase/functions/_shared/competition';

const db = new PGlite();
beforeAll(async () => {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    insert into auth.users values ('11111111-1111-4111-8111-111111111111');`);
  const base = readdirSync('supabase/migrations').find((file) =>
    file.endsWith('_online_competition.sql'),
  )!;
  await db.exec(readFileSync(`supabase/migrations/${base}`, 'utf8'));
  const optimization = readdirSync('supabase/migrations').find((file) =>
    file.endsWith('_online_click_latency.sql'),
  )!;
  await db.exec(readFileSync(`supabase/migrations/${optimization}`, 'utf8'));
}, 30_000);
afterAll(() => db.close());

it('indexes active rounds only', async () => {
  const rows = await db.query<{ indexdef: string }>(
    `select indexdef from pg_indexes where schemaname='public'
      and indexname='online_rounds_active_player_competition_idx'`,
  );
  expect(rows.rows).toHaveLength(1);
  const indexdef = rows.rows[0].indexdef;
  expect(indexdef).toContain('(player_id, competition_id, started_at DESC)');
  expect(indexdef).toContain('WHERE (finished_at IS NULL)');
});

it('caches preflight without credentials', async () => {
  const repository: RoundRepository = {
    start: async () => {
      throw new Error('not expected');
    },
    get: async () => null,
    commit: async () => {
      throw new Error('not expected');
    },
  };
  const handler = createCompetitionHandler(async () => null, repository, Math.random);
  const response = await handler(
    new Request('https://example.com/competition', { method: 'OPTIONS' }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
});
