import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  newOnlineGame,
  handleCompetition,
  type Round,
  type RoundRepository,
} from '../../supabase/functions/_shared/competition';
import type { Game } from '../game/engine';

const db = new PGlite();
const player = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
async function sql<T>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows;
}
const repository: RoundRepository = {
  async start(id, name, state) {
    return (
      await sql<{ r: Round }>('select public.start_online_round($1,$2,$3) as r', [
        id,
        name,
        JSON.stringify(state),
      ])
    )[0].r;
  },
  async get(id, owner) {
    return (
      (
        await sql<Round>('select * from public.online_rounds where id=$1 and player_id=$2', [
          id,
          owner,
        ])
      )[0] ?? null
    );
  },
  async commit(round, state, requestId) {
    return (
      await sql<{ r: Round }>('select public.commit_online_move($1,$2,$3,$4,$5) as r', [
        round.id,
        round.player_id,
        round.revision,
        JSON.stringify(state),
        requestId,
      ])
    )[0].r;
  },
};
beforeAll(async () => {
  // Real embedded PostgreSQL; only the Supabase platform auth schema/roles are stubbed.
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    insert into auth.users values ('${player}'),('${other}');`);
  const migration = readdirSync('supabase/migrations').find((file) =>
    file.endsWith('_online_competition.sql'),
  )!;
  await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
}, 30_000);
afterAll(() => db.close());

describe('PostgreSQL competition contract', () => {
  it('gives only the server access to rounds and score writes; public can read scores', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expect(db.query('select * from public.online_rounds')).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query(
          `insert into public.online_best_scores values ('club-night-v1', '${player}', '伪造', 1, now())`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`select public.start_online_round('${player}', '伪造', '{}'::jsonb)`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`select public.commit_online_move('${player}','${player}',0,'{}','${player}')`),
      ).rejects.toThrow(/permission denied/);
      expect(await sql('select * from public.online_best_scores')).toEqual([]);
      await db.exec('reset role');
    }
    const tables = await sql<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname in ('online_rounds','online_competitions','online_best_scores')",
    );
    expect(tables).toHaveLength(3);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    // Also prove RLS is a second barrier if a table privilege is accidentally added later.
    const hidden = await repository.start(other, '隐藏棋盘', newOnlineGame());
    await db.exec(
      'grant select on public.online_rounds to authenticated; grant insert on public.online_best_scores to authenticated; set role authenticated',
    );
    expect(await sql('select * from public.online_rounds')).toEqual([]);
    await expect(
      db.query(
        `insert into public.online_best_scores values ('club-night-v1', '${player}', '伪造', 1, now())`,
      ),
    ).rejects.toThrow(/row-level security/);
    await db.exec(
      'reset role; revoke select on public.online_rounds from authenticated; revoke insert on public.online_best_scores from authenticated',
    );
    expect(await sql('select * from public.online_rounds')).toHaveLength(1);
    await db.query('delete from public.online_rounds where id=$1', [hidden.id]);
  });
  it('starts/resumes only one active round and accepts only server-computed victory', async () => {
    await db.exec('set role service_role');
    const start = await handleCompetition(
      { action: 'start', name: '土豆队长' },
      player,
      repository,
    );
    expect(start.game.config).toEqual({ rows: 8, cols: 8, mines: 10 });
    expect(
      (await handleCompetition({ action: 'start', name: '更名' }, player, repository)).id,
    ).toBe(start.id);
    await expect(
      handleCompetition(
        {
          action: 'move',
          roundId: start.id,
          revision: 0,
          requestId: randomUUID(),
          move: { kind: 'reveal', index: 0 },
        },
        other,
        repository,
      ),
    ).rejects.toThrow(/不属于/);
    const first = await handleCompetition(
      {
        action: 'move',
        roundId: start.id,
        revision: 0,
        requestId: randomUUID(),
        move: { kind: 'reveal', index: 0 },
        seconds: 0,
        won: true,
      },
      player,
      repository,
      Date.now(),
      () => 0,
    );
    expect(first.game.status).toBe('playing');
    expect(first.game.cells.filter((c) => c.mine)).toHaveLength(0);
    expect(await sql('select * from public.online_best_scores')).toHaveLength(0);
    const real = (await repository.get(start.id, player))!;
    const requestId = randomUUID();
    const move = {
      action: 'move',
      roundId: start.id,
      revision: real.revision,
      requestId,
      move: { kind: 'reveal', index: 63 },
    };
    const won = await handleCompetition(move, player, repository, Date.now(), () => 0);
    expect(won.game.status).toBe('won');
    expect((await handleCompetition(move, player, repository)).revision).toBe(won.revision);
    const scores = await sql<{ elapsed_ms: number; display_name: string }>(
      'select * from public.online_best_scores',
    );
    expect(scores).toHaveLength(1);
    expect(scores[0].display_name).toBe('土豆队长');
    expect(scores[0].elapsed_ms).toBeGreaterThan(0);
    await db.exec('reset role');
  });
  it('uses database time, replaces only better scores and rejects stale writes', async () => {
    // Fixture-only aging avoids sleeping and makes expected times independent of TS calculation.
    await db.exec(
      `update public.online_rounds set started_at=now()-interval '4 seconds' where player_id='${player}'; delete from public.online_rounds where player_id='${player}'; delete from public.online_best_scores`,
    );
    let round = await repository.start(player, '第一次', newOnlineGame());
    const win: Game = { ...newOnlineGame(), status: 'won' };
    await db.exec(
      `update public.online_rounds set started_at=clock_timestamp()-interval '20 seconds' where id='${round.id}'`,
    );
    const finished = await repository.commit(round, win, randomUUID());
    const first = (
      await sql<{ elapsed_ms: number; achieved_at: string }>(
        'select * from public.online_best_scores',
      )
    )[0];
    expect(first.elapsed_ms).toBeGreaterThanOrEqual(20_000);
    expect(first.elapsed_ms).toBeLessThan(21_000);
    expect(finished.finished_at).toBeTruthy();
    round = await repository.start(player, '更慢', newOnlineGame());
    await db.exec(
      `update public.online_rounds set started_at=clock_timestamp()-interval '30 seconds' where id='${round.id}'`,
    );
    await repository.commit(round, win, randomUUID());
    expect((await sql('select * from public.online_best_scores'))[0]).toMatchObject({
      display_name: '第一次',
      elapsed_ms: first.elapsed_ms,
    });
    round = await repository.start(player, '更快', newOnlineGame());
    await db.exec(
      `update public.online_rounds set started_at=clock_timestamp()-interval '10 seconds' where id='${round.id}'`,
    );
    const advanced = await repository.commit(round, round.state, randomUUID());
    await expect(repository.commit(round, win, randomUUID())).rejects.toThrow(/revision conflict/);
    await repository.commit(advanced, win, randomUUID());
    expect((await sql('select * from public.online_best_scores'))[0]).toMatchObject({
      display_name: '更快',
    });
    expect(await sql('select * from public.online_best_scores')).toHaveLength(1);
  });
  it('rejects late wins even when the Edge clock thinks there is time', async () => {
    const round = await repository.start(other, '超时玩家', newOnlineGame());
    await db.exec(
      `update public.online_rounds set started_at=clock_timestamp()-interval '181 seconds' where id='${round.id}'`,
    );
    const result = await repository.commit(round, { ...round.state, status: 'won' }, randomUUID());
    expect(result.state.status).toBe('timeout');
    expect(
      await sql('select * from public.online_best_scores where player_id=$1', [other]),
    ).toHaveLength(0);
  });
  it('enforces a short start cooldown and event closure', async () => {
    await db.exec(`delete from public.online_rounds where player_id='${other}'`);
    const round = await repository.start(other, '限流', newOnlineGame());
    await repository.commit(round, { ...round.state, status: 'lost' }, randomUUID());
    await expect(repository.start(other, '限流', newOnlineGame())).rejects.toThrow(/rate limit/);
    await db.exec('update public.online_competitions set enabled=false');
    await expect(repository.start(player, '结束', newOnlineGame())).rejects.toThrow(
      /competition closed/,
    );
  });
});
