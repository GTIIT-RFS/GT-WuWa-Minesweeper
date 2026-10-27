import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import { ApiError, type Round, type RoundRepository } from '../_shared/competition.ts';
import { createCompetitionHandler } from '../_shared/http.ts';

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
  if (error.code === '40001') throw new ApiError(409, '对局已更新，请重新连接。');
  if (error.code === 'P0001') throw new ApiError(429, '比赛未开放或操作过快，请稍后重试。');
  throw new ApiError(503, '排行榜服务暂时不可用，请重试。');
};
const repository: RoundRepository = {
  async start(player, name, state) {
    const { data, error } = await server.rpc('start_online_round', {
      p_player: player,
      p_name: name,
      p_state: state,
    });
    dbError(error);
    return data as Round;
  },
  async get(id, player) {
    const { data, error } = await server
      .from('online_rounds')
      .select('*')
      .eq('id', id)
      .eq('player_id', player)
      .maybeSingle();
    dbError(error);
    return data as Round | null;
  },
  async commit(round, state, requestId) {
    const { data, error } = await server.rpc('commit_online_move', {
      p_round: round.id,
      p_player: round.player_id,
      p_revision: round.revision,
      p_state: state,
      p_request: requestId,
    });
    dbError(error);
    return data as Round;
  },
};
Deno.serve(
  createCompetitionHandler(
    async (token) => {
      // Do not authorize with decoded JWT contents or editable user_metadata.
      const {
        data: { user },
        error,
      } = await server.auth.getUser(token);
      return !error && user?.email_confirmed_at && !user.is_anonymous ? user.id : null;
    },
    repository,
    () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  ),
);
