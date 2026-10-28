import { test, expect } from './helpers/event-server';

test('parallel players can start and submit moves without cross-player state leakage', async ({
  eventServer,
}) => {
  const players = Array.from({ length: 8 }, () => crypto.randomUUID());
  const starts = await Promise.all(
    players.map((id, index) =>
      eventServer.api({ action: 'start', name: `并发玩家${index + 1}` }, id),
    ),
  );
  expect(starts.map((result) => result.status)).toEqual(Array(8).fill(200));

  const rounds = starts.map((result) => result.body as { id: string; revision: number });
  expect(new Set(rounds.map((round) => round.id)).size).toBe(8);

  const moves = await Promise.all(
    rounds.map((round, index) =>
      eventServer.api(
        {
          action: 'move',
          roundId: round.id,
          revision: round.revision,
          requestId: crypto.randomUUID(),
          move: { kind: 'reveal', index: 0 },
        },
        players[index],
      ),
    ),
  );
  expect(moves.map((result) => result.status)).toEqual(Array(8).fill(200));
  expect(moves.map((result) => (result.body as { revision: number }).revision)).toEqual(
    Array(8).fill(1),
  );

  const ids = players.map((_, index) => `$${index + 1}`).join(',');
  const stored = await eventServer.rows<{ player_id: string; revision: number }>(
    `select player_id,revision from public.online_rounds where player_id in (${ids})`,
    players,
  );
  expect(stored).toHaveLength(8);
  expect(new Set(stored.map((round) => round.player_id)).size).toBe(8);
  expect(stored.every((round) => round.revision === 1)).toBe(true);
});

test('simultaneous starts for one player return one active round', async ({ eventServer }) => {
  const player = crypto.randomUUID();
  const starts = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      eventServer.api({ action: 'start', name: `重复开局${index + 1}` }, player),
    ),
  );
  expect(starts.map((result) => result.status)).toEqual(Array(6).fill(200));
  expect(new Set(starts.map((result) => (result.body as { id: string }).id)).size).toBe(1);
  const active = await eventServer.rows<{ count: number }>(
    'select count(*)::int as count from public.online_rounds where player_id=$1 and finished_at is null',
    [player],
  );
  expect(active[0].count).toBe(1);
});

test('database functions use shared competition locks and keep per-round serialization', async ({
  eventServer,
}) => {
  const functions = await eventServer.rows<{ name: string; definition: string }>(
    `select proname as name,pg_get_functiondef(oid) as definition
       from pg_proc
       where oid in (
         'public.start_online_round(uuid,text,jsonb)'::regprocedure,
         'public.commit_online_move(uuid,uuid,integer,jsonb,uuid)'::regprocedure
       )`,
  );
  const start = functions.find((fn) => fn.name === 'start_online_round')?.definition ?? '';
  const commit = functions.find((fn) => fn.name === 'commit_online_move')?.definition ?? '';
  expect(start).toMatch(/pg_advisory_xact_lock/);
  expect(start).toMatch(/online_competitions[\s\S]*?for share/i);
  expect(commit).toMatch(/online_competitions[\s\S]*?for share/i);
  expect(commit).toMatch(/where id=p_round and player_id=p_player for update/i);
});
