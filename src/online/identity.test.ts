import { beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('./client', () => ({ supabase: { auth } }));
import { ensureAnonymousSession } from './identity';
beforeEach(() => vi.resetAllMocks());
it('restores a persisted session without registering another anonymous user', async () => {
  const session = { access_token: 'existing', user: { id: 'existing-player' } };
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  expect(await ensureAnonymousSession()).toBe(session);
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
});
it('creates one real anonymous account for concurrent start attempts and forwards the CAPTCHA token', async () => {
  const session = { access_token: 'anonymous', user: { id: 'new-player', is_anonymous: true } };
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data: { session }, error: null });
  const sessions = await Promise.all([
    ensureAnonymousSession('captcha'),
    ensureAnonymousSession('captcha'),
  ]);
  expect(sessions).toEqual([session, session]);
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  expect(auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'captcha' } });
});
it('does not replace an identity when session restoration fails', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('network') });
  await expect(ensureAnonymousSession()).rejects.toThrow(/恢复匿名身份/);
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
});
it('can retry failed anonymous creation without retaining a rejected promise', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValueOnce({
    data: { session: null },
    error: new Error('captcha'),
  });
  await expect(ensureAnonymousSession()).rejects.toThrow(/创建失败/);
  const session = { user: { id: 'retry' } };
  auth.signInAnonymously.mockResolvedValueOnce({ data: { session }, error: null });
  expect(await ensureAnonymousSession('new-captcha')).toBe(session);
});
