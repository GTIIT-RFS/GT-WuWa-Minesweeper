import { useCallback, useEffect, useRef, useState } from 'react';
import { readLeaderboard, supabase, type OnlineScore } from '../online/client';

export function OnlineLeaderboard({ display = false }: { display?: boolean }) {
  const [scores, setScores] = useState<OnlineScore[]>([]);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const [page, setPage] = useState(0);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setScores(await readLeaderboard());
      setUpdated(new Date());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);
  const pages = Math.max(1, Math.ceil(scores.length / 5));
  const currentPage = page % pages;
  useEffect(() => {
    if (!display || pages <= 1) return;
    const timer = window.setInterval(() => setPage((p) => p + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [display, pages]);
  useEffect(() => {
    if (!supabase) return;
    let disposed = false;
    // Sequential polling prevents overlapping requests and stale response ordering.
    let timer: number;
    async function poll() {
      await refresh();
      if (!disposed) timer = window.setTimeout(() => void poll(), 10_000);
    }
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [refresh]);
  const joinUrl = `${location.origin}${location.pathname}#online`;
  return (
    <section className={`panel online-leaderboard ${display ? 'projection' : ''}`}>
      <span className="eyebrow">GT WUWA · CLUB NIGHT / ONLINE</span>
      <h1>{display ? '土豆扫雷 · 全场排行榜' : '全体玩家共享排行榜'}</h1>
      <p>统一赛制：8 × 8 · 10 颗土豆 · 180 秒 · 首格安全 · 仅有效胜局入榜</p>
      <p className="muted">每个邮箱账号仅展示最佳成绩；用时相同按达成时间排序。显示前 100 名。</p>
      {!supabase ? (
        <p role="status">在线服务尚未配置，原有离线游戏仍可游玩。</p>
      ) : (
        <>
          <div className="online-toolbar">
            <span role="status">
              {updated
                ? `最近更新 ${updated.toLocaleTimeString()} · 每 10 秒刷新`
                : '正在读取排行榜…'}
            </span>
            <button disabled={loading} onClick={() => void refresh()}>
              刷新排行榜
            </button>
          </div>
          {error && (
            <p role="alert">
              {error}
              {updated ? ' 当前展示上次成功读取的数据。' : ''}
            </p>
          )}
          {!scores.length && updated && <p>还没有有效成绩，成为今晚第一位安全撤离的共鸣者吧！</p>}
          {!!scores.length && (
            <ol className="online-score-list">
              {(display ? scores.slice(currentPage * 5, currentPage * 5 + 5) : scores).map(
                (score, index) => (
                  <li key={score.player_id}>
                    <b className="online-rank">
                      {String(index + 1 + (display ? currentPage * 5 : 0)).padStart(2, '0')}
                    </b>
                    <strong>{score.display_name}</strong>
                    <span>
                      {(score.elapsed_ms / 1000).toFixed(3)}
                      <small> 秒</small>
                    </span>
                  </li>
                ),
              )}
            </ol>
          )}
        </>
      )}
      {display && (
        <div className="join-address">
          <p>
            第 {currentPage + 1} / {pages} 屏 · 每 15 秒轮播
          </p>
          手机 / 电脑参赛：<a href="#online">{joinUrl}</a>
        </div>
      )}
    </section>
  );
}
