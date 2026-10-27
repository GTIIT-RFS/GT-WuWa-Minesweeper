import { createClient } from '@supabase/supabase-js';
import type { PublicRound, Move } from '../../supabase/functions/_shared/competition';
import { isPublicKey } from './config';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase =
  url && /^https:\/\//.test(url) && isPublicKey(key)
    ? createClient(url, key!, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;
export interface OnlineScore {
  player_id: string;
  display_name: string;
  elapsed_ms: number;
  achieved_at: string;
}
export async function readLeaderboard(): Promise<OnlineScore[]> {
  if (!supabase) throw new Error('在线排行榜尚未配置。');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const { data, error } = await supabase
      .from('online_best_scores')
      .select('player_id,display_name,elapsed_ms,achieved_at')
      .eq('competition_id', 'club-night-v1')
      .order('elapsed_ms')
      .order('achieved_at')
      .order('player_id')
      .limit(100)
      .abortSignal(controller.signal);
    if (error) throw new Error('暂时无法刷新排行榜，请稍后重试。');
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}
export type OnlineRequest =
  | { action: 'start'; name: string }
  | {
      action: 'move';
      roundId: string;
      revision: number;
      requestId: string;
      move: Move;
    };
export async function competitionRequest(body: OnlineRequest): Promise<PublicRound> {
  if (!supabase) throw new Error('在线比赛尚未配置。');
  const { data, error } = await supabase.functions.invoke('competition', { body, timeout: 15_000 });
  if (error) {
    let message = '网络请求失败，请重试同一操作；服务器会防止重复计分。';
    if (error.context instanceof Response) {
      const result = await error.context.json().catch(() => null);
      if (result?.error) message = result.error;
    }
    throw new Error(message);
  }
  return data as PublicRound;
}
