import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import { ApiError, type Round, type RoundRepository } from '../_shared/competition.ts';
import { createCompetitionHandler } from '../_shared/http.ts';
import type { EventRepository } from '../_shared/event-types.ts';

// The Supabase runtime supplies these values on the server. Never prefix them with VITE_.
const server = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const dbError = (error: { code?: string } | null) => {
  if (!error) return;
  if (error.code === '42501') throw new ApiError(403, '没有权限或领奖凭证无效。');
  if (error.code === '40001') throw new ApiError(409, '对局已更新，请重新连接。');
  if (error.code === 'P0001')
    throw new ApiError(409, '操作不符合当前赛程或领奖状态，请刷新后重试。');
  if (error.code?.startsWith('22'))
    throw new ApiError(400, '输入格式无效，请检查日期、数字或编号。');
  if (error.code === '23505') throw new ApiError(409, '已有记录，请刷新查看。');
  throw new ApiError(503, '排行榜服务暂时不可用，请重试。');
};
const timedRpc = async (name: string, args: Record<string, unknown>) => {
  const started = performance.now();
  const result = await server.rpc(name, args);
  console.info(
    JSON.stringify({
      event: 'competition_rpc',
      rpc: name,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      ok: !result.error,
      code: result.error?.code ?? null,
    }),
  );
  dbError(result.error);
  return result.data;
};
const repository: RoundRepository = {
  async start(player, name, state) {
    return (await timedRpc('start_online_round', {
      p_player: player,
      p_name: name,
      p_state: state,
    })) as Round;
  },
  async get(id, player) {
    return (await timedRpc('event_get_round', {
      p_round: id,
      p_player: player,
    })) as Round | null;
  },
  async commit(round, state, requestId) {
    return (await timedRpc('commit_online_move', {
      p_round: round.id,
      p_player: round.player_id,
      p_revision: round.revision,
      p_state: state,
      p_request: requestId,
    })) as Round;
  },
};
const testRepository: RoundRepository = {
  async start(player, name, state) {
    return (await timedRpc('event_test_start', {
      p_player: player,
      p_name: name,
      p_state: state,
    })) as Round;
  },
  get: repository.get,
  async commit(round, state, requestId) {
    return (await timedRpc('event_test_commit', {
      p_round: round.id,
      p_player: round.player_id,
      p_revision: round.revision,
      p_state: state,
      p_request: requestId,
    })) as Round;
  },
};
const call = (name: string, args: Record<string, unknown>) => timedRpc(name, args);
const events: EventRepository = {
  overview: (player) => call('event_overview', { p_player: player }),
  board: (kind, stage, player, page) =>
    call('event_board', { p_kind: kind, p_stage: stage, p_player: player, p_page: page }),
  awards: (player) => call('event_my_awards', { p_player: player }),
  adminRead: (player, page) => call('event_admin_read', { p_actor: player, p_page: page }),
  adminAction: (player, request, operation, payload) =>
    call('event_admin_action', {
      p_actor: player,
      p_request: request,
      p_action: operation,
      p_payload: payload,
    }),
  testOverview: (player) => call('event_test_overview', { p_player: player }),
  testBoard: (kind, stage, player, page) =>
    call('event_test_board', { p_kind: kind, p_stage: stage, p_player: player, p_page: page }),
  testAwards: (player) => call('event_test_awards', { p_player: player }),
  testAdminSettle: (player, request) =>
    call('event_test_admin_settle', { p_actor: player, p_request: request }),
  testAdminAction: (player, request, operation, payload) =>
    call('event_test_admin_action', {
      p_actor: player,
      p_request: request,
      p_action: operation,
      p_payload: payload,
    }),
};
Deno.serve(
  createCompetitionHandler(
    async (token) => {
      // getClaims verifies JWT signatures and uses cached JWKS for asymmetric signing keys.
      // Supabase JS falls back to getUser for legacy symmetric JWT signing keys.
      // Never authorize with decoded, unverified claims or editable user_metadata.
      const { data, error } = await server.auth.getClaims(token);
      const claims = data?.claims;
      const id = typeof claims?.sub === 'string' ? claims.sub : null;
      return !error && id ? { id, isAnonymous: claims.is_anonymous === true } : null;
    },
    repository,
    () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
    events,
    testRepository,
  ),
);
