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
    insert into auth.users values ('${player}',true),('${other}',true),('${admin}',false);
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant all on sequences to anon,authenticated;`);
  for (const file of readdirSync('supabase/migrations')
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await clock('2030-06-01T09:00:00Z');
}, 30000);
afterAll(() => db.close());
it('installs an additive upgrade and keeps the event closed until a date is configured', async () => {
  expect(
    await rows("select * from public.online_competitions where id='club-night-v1'"),
  ).toHaveLength(1);
  await expect(start()).rejects.toThrow(/event not open/);
  await db.query('insert into public.event_admins(user_id) values ($1)', [admin]);
  await adminAction('configure', { date: '2030-06-01' });
  const stages = await rows<{ starts_at: string; ends_at: string }>(
    "select * from public.event_stages where competition_id='club-night-v1' order by round_no",
  );
  expect(stages).toHaveLength(4);
  expect(new Date(stages[0].starts_at).toISOString()).toBe('2030-06-01T10:00:00.000Z');
  expect(new Date(stages[3].ends_at).toISOString()).toBe('2030-06-01T14:00:00.000Z');
  const fourth = (
    await rows<{ id: string }>(
      "select id from public.event_stages where competition_id='club-night-v1' and round_no=4",
    )
  )[0].id;
  await adminAction('prizes', { stageId: fourth, count: 3 });
  await expect(adminAction('prizes', { stageId: fourth, count: 21 })).rejects.toThrow(
    /invalid prize count/,
  );
  await adminAction('schedule', {
    stageId: fourth,
    startsAt: '2030-06-01T21:00:00+08:00',
    endsAt: '2030-06-01T22:00:00+08:00',
    reason: '确认正式安排',
  });
  await expect(
    adminAction('schedule', {
      stageId: fourth,
      startsAt: '2030-06-01T20:30:00+08:00',
      endsAt: '2030-06-01T21:30:00+08:00',
      reason: '重叠安排',
    }),
  ).rejects.toThrow(/invalid schedule/);
  await expect(
    adminAction('schedule', {
      stageId: fourth,
      startsAt: '2030-06-01T21:00:00+08:00',
      endsAt: '2030-06-01T22:01:00+08:00',
      reason: '时长错误',
    }),
  ).rejects.toThrow(/invalid schedule/);
  await expect(adminAction('configure', { date: '2030-05-31' })).rejects.toThrow(/future/);
});
it('enforces 18:00 open and 18:57 new-game cutoff using the database clock', async () => {
  await clock('2030-06-01T09:59:59.999Z');
  await expect(start()).rejects.toThrow(/event not open/);
  await clock('2030-06-01T10:00:00Z');
  const game = await start();
  expect(game.stage_id).toBeTruthy();
  await adminAction('pause', { paused: true });
  await expect(start(other)).rejects.toThrow(/event not open/);
  await expect(finish(game)).rejects.toThrow(/event paused/);
  await adminAction('pause', { paused: false });
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

it('preserves each win, only improves a stage best and prepares multiple ranked candidates', async () => {
  const firstStage = (
    await rows<{ id: string }>(
      "select id from public.event_stages where competition_id='club-night-v1' and round_no=1",
    )
  )[0].id;
  expect(
    await rows('select * from public.event_bests where stage_id=$1', [firstStage]),
  ).toHaveLength(1);
  const extras = Array.from({ length: 4 }, () => randomUUID());
  for (let i = 0; i < extras.length; i++) {
    await db.query('insert into auth.users values ($1,true)', [extras[i]]);
    await clock(`2030-06-01T10:3${i}:00Z`);
    const game = await start(extras[i], `候选${i + 1}`);
    await clock(`2030-06-01T10:3${i}:0${i + 2}Z`);
    await finish(game, extras[i]);
  }
  // The two earlier wins took 10,000 and 10,001 ms: only the former may remain best.
  const best = (
    await rows<{ elapsed_ms: number }>(
      'select * from public.event_bests where stage_id=$1 and player_id=$2',
      [firstStage, player],
    )
  )[0];
  expect(best.elapsed_ms).toBe(10_000);
  expect(await rows('select * from public.event_wins where player_id=$1', [player])).toHaveLength(
    2,
  );
});
it('at 19:00 closes the old game, freezes first-round results exactly once and opens round two', async () => {
  await clock('2030-06-01T10:56:59.999Z');
  const late = await start(other, '迟到成绩');
  await clock('2030-06-01T11:00:00Z');
  expect((await finish(late, other)).state.status).toBe('timeout');
  expect(await rpc('event_settle_due')).toBe(1);
  const snapshots = await rows('select * from public.event_rankings order by stage_id,rank');
  expect(snapshots).toHaveLength(5);
  expect(await rows('select * from public.event_awards')).toHaveLength(3);
  const tokens = await rows('select * from public.event_credentials order by award_id');
  expect(await rpc('event_settle_due')).toBe(0);
  expect(await rows('select * from public.event_credentials order by award_id')).toEqual(tokens);
  const next = await start();
  const stage = (
    await rows<{ round_no: number }>('select round_no from public.event_stages where id=$1', [
      next.stage_id,
    ])
  )[0];
  expect(stage.round_no).toBe(2);
  await clock('2030-06-01T11:00:30Z');
  await finish(next);
  const bests = await rows<{ elapsed_ms: number }>(
    'select * from public.event_bests where player_id=$1 order by achieved_at',
    [player],
  );
  expect(bests.map((x) => x.elapsed_ms)).toEqual([10000, 30000]);
  expect(await rows('select * from public.event_rankings order by stage_id,rank')).toEqual(
    snapshots,
  );
  await clock('2030-06-01T11:57:00Z');
  await expect(start(other)).rejects.toThrow(/new games closed/);
});
it('enforces exact 20:00 / 21:00 / 22:00 boundaries and late-job catch-up', async () => {
  for (const [hour, roundNo] of [
    [12, 3],
    [13, 4],
  ]) {
    await clock(`2030-06-01T${hour}:00:00Z`);
    const game = await start();
    expect(
      (
        await rows<{ round_no: number }>('select round_no from public.event_stages where id=$1', [
          game.stage_id,
        ])
      )[0].round_no,
    ).toBe(roundNo);
    await clock(`2030-06-01T${hour}:00:05Z`);
    await finish(game);
    if (hour === 12) {
      await clock('2030-06-01T12:57:00Z');
      await expect(start(other)).rejects.toThrow(/new games closed/);
    }
  }
  await clock('2030-06-01T13:56:59.999Z');
  const late = await start(other);
  await clock('2030-06-01T13:57:00Z');
  await expect(start()).rejects.toThrow(/new games closed/);
  await clock('2030-06-01T14:00:00Z');
  expect((await finish(late, other)).state.status).toBe('timeout');
  await expect(start()).rejects.toThrow(/event not open/);
  const before = await rows('select * from public.event_wins');
  await clock('2030-06-01T14:05:00Z');
  expect(await rpc('event_settle_due')).toBe(3);
  expect(await rows('select * from public.event_wins')).toEqual(before);
  expect(await rpc('event_settle_due')).toBe(0);
  expect(await rows('select * from public.event_stages where settled_at is not null')).toHaveLength(
    4,
  );
  const overview = await rpc<{
    state: string;
    currentStage: unknown;
    evening: { mine: { elapsed_ms: number } };
  }>('event_overview', [player]);
  expect(overview.state).toBe('ended');
  expect(overview.currentStage).toBeNull();
  expect(overview.evening.mine.elapsed_ms).toBe(5000);
});
it('makes snapshots and audit append-only, exposes no credentials publicly and rejects non-admins', async () => {
  await expect(db.exec('update public.event_rankings set rank=99')).rejects.toThrow(
    /immutable history/,
  );
  await expect(db.exec('delete from public.event_audit')).rejects.toThrow(/immutable history/);
  await expect(adminAction('pause', { paused: true }, player)).rejects.toThrow(/admin required/);
  await db.query('insert into public.event_admins values ($1)', [player]);
  await expect(adminAction('pause', { paused: true }, player)).rejects.toThrow(/admin required/);
  const overview = await rpc('event_overview', [player]);
  expect(JSON.stringify(overview)).not.toContain('token');
  const mine = await rpc<unknown[]>('event_my_awards', [player]);
  expect(mine).toHaveLength(3);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of [
      'online_rounds',
      'event_wins',
      'event_credentials',
      'event_claims',
      'event_admins',
      'event_audit',
    ])
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
    await expect(db.exec('delete from public.event_awards')).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.event_settle_due()')).rejects.toThrow(/permission denied/);
    await expect(db.query("select nextval('public.event_audit_id_seq')")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`select public.event_admin_action('${admin}','${randomUUID()}','pause','{}')`),
    ).rejects.toThrow(/permission denied/);
    expect((await rows('select * from public.event_rankings')).length).toBeGreaterThan(0);
    await db.exec('reset role');
  }
});
it('verifies a server-generated credential once, retries idempotently and records the operator', async () => {
  const award = (
    await rows<{ id: string; player_id: string }>(
      'select * from public.event_awards order by created_at,prize_slot limit 1',
    )
  )[0];
  const token = (
    await rows<{ token: string }>('select token from public.event_credentials where award_id=$1', [
      award.id,
    ])
  )[0].token;
  await expect(
    adminAction('claim', {
      awardId: award.id,
      credential: 'forged',
      participantRef: 'sticker-01',
      verifiedInPerson: true,
    }),
  ).rejects.toThrow(/credential invalid/);
  await expect(
    adminAction('claim', {
      awardId: award.id,
      credential: token,
      participantRef: 'sticker-01',
      verifiedInPerson: false,
    }),
  ).rejects.toThrow(/onsite verification/);
  const payload = {
    awardId: award.id,
    credential: token,
    participantRef: 'sticker-01',
    verifiedInPerson: true,
  };
  const request = randomUUID();
  expect(await adminAction('claim', payload, admin, request)).toMatchObject({ ok: true });
  expect(await adminAction('claim', payload, admin, request)).toMatchObject({
    ok: true,
    replayed: true,
  });
  await expect(adminAction('claim', payload)).rejects.toThrow(/already used/);
  const audits = await rows<{
    actor_id: string;
    new_state: { status: string };
    old_state: { status: string };
  }>("select * from public.event_audit where action='claim'");
  expect(audits).toHaveLength(1);
  expect(audits[0].actor_id).toBe(admin);
  expect(audits[0].old_state.status).toBe('pending');
  expect(audits[0].new_state.status).toBe('claimed');
  expect(JSON.stringify(audits)).not.toContain(token);
  const second = (
    await rows<{ id: string }>(
      'select * from public.event_awards where id<>$1 order by created_at,prize_slot limit 1',
      [award.id],
    )
  )[0];
  const secondToken = (
    await rows<{ token: string }>('select token from public.event_credentials where award_id=$1', [
      second.id,
    ])
  )[0].token;
  await expect(
    adminAction('claim', {
      awardId: second.id,
      credential: secondToken,
      participantRef: 'sticker-01',
      verifiedInPerson: true,
    }),
  ).rejects.toThrow(/person already claimed/);
});
it('rolls a waived gift to the next eligible rank without rewriting any snapshot', async () => {
  const before = await rows('select * from public.event_rankings order by stage_id,rank');
  const award = (
    await rows<{ id: string; stage_id: string }>(
      'select * from public.event_awards where prize_slot=2 limit 1',
    )
  )[0];
  await adminAction('status', { awardId: award.id, status: 'waived', reason: '本人现场确认放弃' });
  const rolled = await adminAction('rollover', { awardId: award.id, reason: '按公示规则顺延' });
  expect(rolled).toHaveProperty('successorAwardId');
  const successor = (
    await rows<{ prize_slot: number; player_id: string }>(
      'select * from public.event_awards where predecessor_id=$1',
      [award.id],
    )
  )[0];
  expect(successor.prize_slot).toBe(2);
  expect(
    (
      await rows<{ rank: number }>(
        'select rank from public.event_rankings where stage_id=$1 and player_id=$2',
        [award.stage_id, successor.player_id],
      )
    )[0].rank,
  ).toBe(4);
  expect(await rows('select * from public.event_rankings order by stage_id,rank')).toEqual(before);
  await expect(adminAction('rollover', { awardId: award.id, reason: '重复顺延' })).rejects.toThrow(
    /already rolled over/,
  );
  await expect(adminAction('prizes', { stageId: award.stage_id, count: 6 })).rejects.toThrow(
    /frozen/,
  );
});

it('keeps test games, settlement, credentials and claims isolated from the official event', async () => {
  const initialTest = await rpc<{
    event: { id: string };
    state: string;
    currentStage: { id: string };
  }>('event_test_overview', [player]);
  expect(initialTest.state).toBe('open');
  expect(initialTest.event.id).toMatch(/^club-night-test-/);
  expect((await rpc('event_overview', [player])).state).toBe('ended');

  const testGame = await rpc<{
    id: string;
    player_id: string;
    revision: number;
    stage_id: string;
    state: ReturnType<typeof newOnlineGame>;
  }>('event_test_start', [player, '测试隔离玩家', newOnlineGame()]);
  const win = await rpc<{ state: { status: string } }>('event_test_commit', [
    testGame.id,
    player,
    testGame.revision,
    { ...testGame.state, status: 'won' },
    randomUUID(),
  ]);
  expect(win.state.status).toBe('won');

  const live = await rpc<{ entries: { display_name: string }[] }>('event_test_board', [
    'live',
    testGame.stage_id,
    player,
    0,
  ]);
  expect(live.entries.map((x) => x.display_name)).toContain('测试隔离玩家');
  const formalBefore = await rpc<{ stages: { id: string }[]; awards: { display_name: string }[] }>(
    'event_overview',
    [player],
  );
  expect(formalBefore.stages.some((x) => x.id === testGame.stage_id)).toBe(false);
  expect(formalBefore.awards.some((x) => x.display_name === '测试隔离玩家')).toBe(false);

  const settleRequest = randomUUID();
  const settled = await rpc<{ ok: boolean; settledCount: number; nextCompetitionId: string }>(
    'event_test_admin_settle',
    [admin, settleRequest],
  );
  expect(settled).toMatchObject({ ok: true, settledCount: 1 });
  expect(await rpc('event_test_admin_settle', [admin, settleRequest])).toMatchObject({
    ok: true,
    replayed: true,
  });
  expect(settled.nextCompetitionId).not.toBe(initialTest.event.id);

  const testAwards = await rpc<
    { id: string; token: string; status: string; display_name: string }[]
  >('event_test_awards', [player]);
  const testAward = testAwards.find((x) => x.display_name === '测试隔离玩家');
  expect(testAward).toMatchObject({ status: 'pending' });
  expect(testAward?.token).toBeTruthy();

  const claimRequest = randomUUID();
  expect(
    await rpc('event_test_admin_action', [
      admin,
      claimRequest,
      'claim',
      {
        awardId: testAward!.id,
        credential: testAward!.token,
        participantRef: 'TEST-STICKER-01',
        verifiedInPerson: true,
      },
    ]),
  ).toMatchObject({ ok: true });
  expect(
    await rows<{ competition_id: string }>('select competition_id from public.event_claims where award_id=$1', [
      testAward!.id,
    ]),
  ).toEqual([{ competition_id: initialTest.event.id }]);

  const formalAfter = await rpc<{ awards: { display_name: string }[] }>('event_overview', [player]);
  expect(formalAfter.awards.some((x) => x.display_name === '测试隔离玩家')).toBe(false);
  const nextTest = await rpc<{ state: string; currentStage: { id: string } }>(
    'event_test_overview',
    [player],
  );
  expect(nextTest.state).toBe('open');
  expect(nextTest.currentStage.id).not.toBe(testGame.stage_id);
});
