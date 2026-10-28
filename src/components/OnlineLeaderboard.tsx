import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { readOverview, readBoard, supabase } from '../online/client';
import { awardLabels, beijing, countdown } from '../online/presentation';
import type {
  EventOverview,
  EventBoard,
  Stage,
} from '../../supabase/functions/_shared/event-types';
const empty: EventBoard = { entries: [], mine: null, total: 0 };
export function OnlineLeaderboard({
  display = false,
  onOverview,
}: {
  display?: boolean;
  onOverview?: (data: EventOverview) => void;
}) {
  const [data, setData] = useState<EventOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'live' | 'history' | 'evening'>('live');
  const [historyStage, setHistoryStage] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const [history, setHistory] = useState<{ key: string; board: EventBoard } | null>(null);
  const [page, setPage] = useState(0);
  const [serverMs, setServerMs] = useState(0);
  const [reveal, setReveal] = useState<Stage | null>(null);
  const [qr, setQr] = useState('');
  const anchor = useRef({ server: 0, received: 0 });
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const seen = useRef(new Set<string>());
  const joinUrl = `${location.origin}${location.pathname}#online`;
  const refresh = useCallback(async () => {
    if (inFlight.current || !supabase) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const next = await readOverview();
      if (!next?.serverNow || !Array.isArray(next.stages))
        throw new Error('比赛服务版本不匹配，请联系工作人员升级。');
      if (!mounted.current) return;
      anchor.current = { server: Date.parse(next.serverNow), received: performance.now() };
      setServerMs(anchor.current.server);
      setData(next);
      setError('');
      onOverview?.(next);
      const recent = next.stages.filter((s) => s.settled_at && !seen.current.has(s.id));
      for (const s of recent) seen.current.add(s.id);
      const last = recent.at(-1);
      if (display && last && Date.parse(next.serverNow) - Date.parse(last.settled_at!) < 60_000)
        setReveal(last);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [display, onOverview]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: number;
    async function poll() {
      await refresh();
      if (!stopped) timer = window.setTimeout(() => void poll(), display ? 5000 : 10000);
    }
    void poll();
    const update = () => {
      window.setTimeout(() => void refresh(), 0);
    };
    window.addEventListener('gt-wuwa:results-updated', update);
    const subscription = supabase?.auth.onAuthStateChange(update).data.subscription;
    return () => {
      mounted.current = false;
      stopped = true;
      window.clearTimeout(timer);
      subscription?.unsubscribe();
      window.removeEventListener('gt-wuwa:results-updated', update);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(
      () => setServerMs(anchor.current.server + performance.now() - anchor.current.received),
      250,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => setReveal(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [reveal]);
  useEffect(() => {
    if (display)
      void QRCode.toDataURL(joinUrl, { width: 160, margin: 1 })
        .then(setQr)
        .catch(() => {});
  }, [display, joinUrl]);
  const selected = historyStage || data?.stages.filter((s) => s.settled_at).at(-1)?.id || '';
  const kind = mode === 'live' && data?.state === 'ended' ? 'evening' : mode;
  const historyKey = `${kind}:${selected}:${historyPage}`;
  useEffect(() => {
    if ((kind !== 'history' || !selected) && !(kind === 'evening' && historyPage > 0)) return;
    let stopped = false;
    void readBoard(kind, kind === 'history' ? selected : null, historyPage)
      .then((board) => {
        if (!stopped) setHistory({ key: `${kind}:${selected}:${historyPage}`, board });
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [kind, selected, historyPage, data?.serverNow]);
  const board =
    kind === 'history' || (kind === 'evening' && historyPage > 0)
      ? history?.key === historyKey
        ? history.board
        : empty
      : (data?.[kind] ?? empty);
  const pages = Math.max(1, Math.ceil(board.entries.length / 5));
  const screen = page % pages;
  useEffect(() => {
    if (!display || pages <= 1) return;
    const timer = window.setInterval(() => setPage((p) => p + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [display, pages]);
  const stage = data?.currentStage;
  const nextStage = data?.stages.find((s) => Date.parse(s.starts_at) > serverMs);
  const deadline = stage?.ends_at ?? nextStage?.starts_at;
  const labels = {
    unconfigured: '活动日期尚未配置',
    upcoming: '等待开赛',
    open: '本轮开放中',
    closing: '已停止开新局 · 已开始对局可继续',
    paused: '紧急暂停 · 计时继续',
    ended: '整晚比赛已结束',
  };
  const currentAwards = data?.awards.filter((a) => a.stage_id === selected) ?? [];
  return (
    <section className={`panel online-leaderboard ${display ? 'projection' : ''}`}>
      <span className="eyebrow">GT WUWA · CLUB NIGHT / 匿名竞速赛</span>
      <div className="event-title-row">
        <div>
          <h1>{display ? '土豆扫雷 · 全场排行榜' : '匿名竞速排行榜'}</h1>
          <p>8 × 8 · 10 雷 · 180 秒 · 首格安全 · 每轮独立最佳成绩</p>
        </div>
        {deadline && (
          <div className="stage-countdown">
            <small>{stage ? '距本轮结算' : '距下一轮开放'}</small>
            <strong>{countdown(Date.parse(deadline) - serverMs)}</strong>
          </div>
        )}
      </div>
      {!supabase ? (
        <p role="status">在线服务尚未配置，原有离线游戏仍可游玩。</p>
      ) : (
        <>
          <div className="stage-banner" role="status">
            <strong>{data ? labels[data.state] : '正在读取服务器赛程…'}</strong>
            {stage && (
              <span>
                第 {stage.round_no} 轮 · 北京时间 {beijing(stage.starts_at, true)}–
                {beijing(stage.ends_at)}
              </span>
            )}
          </div>
          <div className="event-schedule">
            {data?.stages.map((s) => (
              <span key={s.id} className={s.id === stage?.id ? 'current-stage' : ''}>
                第{s.round_no}轮 {beijing(s.starts_at)}–{beijing(s.ends_at)}{' '}
                {s.settled_at ? '已结算' : ''}
              </span>
            ))}
          </div>
          <div className="online-toolbar">
            <div role="tablist" aria-label="排行榜类型">
              {(['live', 'history', 'evening'] as const).map((m, i) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={kind === m}
                  onClick={() => {
                    setMode(m);
                    setPage(0);
                    setHistoryPage(0);
                  }}
                >
                  {['本轮实时榜', '历史获奖榜', '整晚总榜'][i]}
                </button>
              ))}
            </div>
            <button disabled={loading} onClick={() => void refresh()}>
              刷新排行榜
            </button>
          </div>
          {kind === 'history' && (
            <div className="online-toolbar">
              <label>
                查看已结算轮次{' '}
                <select
                  value={selected}
                  onChange={(e) => {
                    setHistoryStage(e.target.value);
                    setHistoryPage(0);
                    setPage(0);
                  }}
                >
                  {data?.stages
                    .filter((s) => s.settled_at)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        第 {s.round_no} 轮 · {beijing(s.settled_at!, true)} 结算
                      </option>
                    ))}
                </select>
              </label>
              {!selected && <span>尚无已结算轮次。</span>}
            </div>
          )}
          {error && (
            <p role="alert">
              {error}
              {data ? ' 当前保留上次成功读取的数据。' : ''}
            </p>
          )}
          {kind === 'history' && currentAwards.length > 0 && (
            <div className="public-awards">
              {currentAwards.map((a) => (
                <span key={a.id}>
                  礼品 {a.prize_slot} · #{a.rank} {a.display_name} · {awardLabels[a.status]}
                  {a.predecessor_id ? '（顺延）' : ''}
                </span>
              ))}
            </div>
          )}
          {!board.entries.length && data && <p>暂无有效成绩。只有本轮服务端确认的通关才能入榜。</p>}
          {board.mine && (
            <p className="personal-rank" role="status">
              你的排名 #{board.mine.rank} · {board.mine.display_name} ·{' '}
              {(board.mine.elapsed_ms / 1000).toFixed(3)} 秒
            </p>
          )}
          {!!board.entries.length && (
            <ol className="online-score-list">
              {(display ? board.entries.slice(screen * 5, screen * 5 + 5) : board.entries).map(
                (score) => (
                  <li
                    key={score.player_id}
                    className={score.rank <= 3 ? `podium-rank rank-${score.rank}` : ''}
                  >
                    <b className="online-rank">{String(score.rank).padStart(2, '0')}</b>
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
          {kind !== 'live' && board.total > 100 && (
            <div className="online-toolbar">
              <button disabled={!historyPage} onClick={() => setHistoryPage((p) => p - 1)}>
                上一页排名
              </button>
              <span>
                第 {historyPage + 1} / {Math.ceil(board.total / 100)} 页
              </span>
              <button
                disabled={(historyPage + 1) * 100 >= board.total}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                下一页排名
              </button>
            </div>
          )}
          {kind === 'evening' && (
            <p className="muted">整晚总榜只作荣誉展示，各轮礼品以冻结排名和现场核验为准。</p>
          )}
          {data?.state === 'ended' && (
            <div className="public-awards">
              {data.awards.map((a) => (
                <span key={a.id}>
                  第{a.round_no}轮 · 礼品{a.prize_slot} · #{a.rank} {a.display_name} ·{' '}
                  {awardLabels[a.status]}
                </span>
              ))}
            </div>
          )}
          <small className="muted">
            服务器校时 · 每 {display ? 5 : 10} 秒刷新 ·{' '}
            {data ? `北京时间 ${beijing(data.serverNow, true)}` : '连接中'}
          </small>
        </>
      )}
      {display && (
        <div className="join-address">
          <div>
            <p>
              第 {screen + 1} / {pages} 屏 · 每 15 秒轮播
            </p>
            手机 / 电脑参赛：<a href="#online">{joinUrl}</a>
          </div>
          {qr && <img src={qr} width="120" height="120" alt="扫码进入匿名竞速赛" />}
        </div>
      )}
      {display && reveal && (
        <section className="winner-reveal" role="status" aria-label="获奖揭晓">
          <span className="eyebrow">POTATO CHAMPIONS / 第 {reveal.round_no} 轮</span>
          <h2>本轮获奖者揭晓</h2>
          <div className="winner-podium">
            {data?.awards
              .filter((a) => a.stage_id === reveal.id && !a.predecessor_id)
              .slice(0, 3)
              .map((a, i) => (
                <article key={a.id}>
                  <b>{['冠军', '亚军', '季军'][i]}</b>
                  <h3>{a.display_name}</h3>
                  <p>{(a.elapsed_ms / 1000).toFixed(3)} 秒</p>
                </article>
              ))}
          </div>
          <p>请获奖者携带当前设备，到工作人员处现场核验。赛程继续，10 秒后自动返回。</p>
        </section>
      )}
    </section>
  );
}
