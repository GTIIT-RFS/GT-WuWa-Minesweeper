import { createClient } from '@supabase/supabase-js';
import type { PublicRound, Move } from '../../supabase/functions/_shared/competition';
import { isPublicKey } from './config';
import type {
  EventOverview,
  EventBoard,
  Award,
  AdminData,
} from '../../supabase/functions/_shared/event-types';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase =
  url && /^https:\/\//.test(url) && isPublicKey(key)
    ? createClient(url, key!, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;
// Staff sign-in must not overwrite a participant's anonymous identity in this browser.
export const staffSupabase =
  url && /^https:\/\//.test(url) && isPublicKey(key)
    ? createClient(url, key!, {
        auth: {
          storageKey: 'gt-wuwa:staff-session:v1',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
export interface OnlineScore {
  player_id: string;
  display_name: string;
  elapsed_ms: number;
  achieved_at: string;
}
export const readOverview = () => eventRequest<EventOverview>({ action: 'overview' });
export const readBoard = (kind: string, stageId: string | null, page = 0) =>
  eventRequest<EventBoard>({ action: 'board', kind, stageId, page });
export const readAwards = () => eventRequest<Award[]>({ action: 'awards' });
export const readAdmin = (page = 0) =>
  eventRequest<AdminData>({ action: 'admin_read', page }, true);
export const adminRequest = (
  operation: string,
  payload: Record<string, unknown>,
  requestId: string,
) =>
  eventRequest<{ ok: boolean; replayed?: boolean }>(
    { action: 'admin_action', operation, payload, requestId },
    true,
  );
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
  return eventRequest<PublicRound>(body);
}
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function eventRequest<T>(body: object, staff = false): Promise<T> {
  const client = staff ? staffSupabase : supabase;
  if (!client) throw new Error('在线比赛尚未配置。');
  const { data, error } = await client.functions.invoke('competition', { body, timeout: 15_000 });
  if (error) {
    let message = '网络请求失败，请重试同一操作；服务器会防止重复计分。';
    if (error.context instanceof Response) {
      const result = await error.context.json().catch(() => null);
      if (result?.error) message = result.error;
    }
    throw new RequestError(message, error.context instanceof Response ? error.context.status : 0);
  }
  return data as T;
}
