import { useEffect, useRef, useState } from 'react';
const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
export const captchaConfigured = !!sitekey;
interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let loading: Promise<void> | null = null;
function load() {
  if (window.turnstile) return Promise.resolve();
  if (!loading)
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        loading = null;
        reject(new Error('人机验证加载失败，请检查网络。'));
      };
      document.head.append(script);
    });
  return loading;
}
export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const target = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState('');
  useEffect(() => {
    if (!sitekey) return;
    let disposed = false;
    let id: string | undefined;
    void load()
      .then(() => {
        if (disposed || !target.current) return;
        id = window.turnstile!.render(target.current, {
          sitekey,
          theme: 'dark',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(''),
          'error-callback': () => {
            callback.current('');
            setError('人机验证失败，请刷新页面重试。');
          },
        });
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      if (id) window.turnstile?.remove(id);
    };
  }, []);
  return (
    <>
      <div ref={target} />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
