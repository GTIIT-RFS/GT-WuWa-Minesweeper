import { supabase } from './client';
import type { Session } from '@supabase/supabase-js';
let creating: Promise<Session> | null = null;
/** Do not create a new identity on a failed refresh or on every page view. */
export async function ensureAnonymousSession(captchaToken?: string): Promise<Session> {
  if (!supabase) throw new Error('在线服务尚未配置。');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('无法恢复匿名身份，请检查网络后重试。');
  if (data.session) return data.session;
  if (!creating) {
    creating = (async () => {
      const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
      if (error || !data.session)
        throw new Error('匿名身份创建失败，请检查网络或重新完成人机验证。');
      return data.session;
    })().finally(() => {
      creating = null;
    });
  }
  return creating;
}
