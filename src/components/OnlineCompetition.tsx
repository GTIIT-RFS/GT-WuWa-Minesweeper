import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { PublicRound, Move } from '../../supabase/functions/_shared/competition';
import { competitionRequest, supabase, type OnlineRequest } from '../online/client';
import type { Settings } from '../storage/settings';
import type { SoundKey } from '../storage/assets';
import { Board } from './Board';
import { OnlineLeaderboard } from './OnlineLeaderboard';
import { ensureAnonymousSession } from '../online/identity';
import { captchaConfigured, Turnstile } from './Turnstile';
import { displayName } from '../../supabase/functions/_shared/competition';
import type { EventOverview } from '../../supabase/functions/_shared/event-types';

export function OnlineCompetition({
  settings,
  urls,
  sound,
  onExplosion,
}: {
  settings: Settings;
  urls: Record<string, string>;
  sound: (key: SoundKey) => void;
  onExplosion: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [overview, setOverview] = useState<EventOverview | null>(null);
  const [round, setRound] = useState<PublicRound | null>(null);
  const [pending, setPending] = useState<OnlineRequest | null>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [flagMode, setFlagMode] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const receivedAt = useRef(performance.now());
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setRound(null);
        setPending(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  async function send(body: OnlineRequest) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError('');
    setPending(body);
    try {
      if (body.action === 'start') {
        displayName(body.name);
        const restored = await ensureAnonymousSession(captchaToken || undefined);
        setSession(restored);
      }
      const next = await competitionRequest(body);
      const previous = round?.game.status;
      receivedAt.current = performance.now();
      setElapsed(next.elapsedMs);
      setRound(next);
      setPending(null);
      if (['won', 'lost', 'timeout'].includes(next.game.status))
        window.dispatchEvent(new Event('gt-wuwa:results-updated'));
      if (next.game.status === 'lost' && previous !== 'lost') {
        sound('warning');
        onExplosion();
      } else if (next.game.status === 'won' && previous !== 'won') sound('win');
      else if (next.game.status === 'timeout' && previous !== 'timeout') sound('timeout');
      else if (body.action === 'move' && body.move.kind !== 'sync')
        sound(body.move.kind === 'flag' ? 'flag' : 'reveal');
    } catch (e) {
      setError((e as Error).message);
      setCaptchaToken('');
      setCaptchaReset((x) => x + 1);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  const active = round && ['ready', 'playing'].includes(round.game.status);
  useEffect(() => {
    if (!active || !round) return;
    const timer = window.setInterval(() => {
      const ms = Math.min(round.limitMs, round.elapsedMs + performance.now() - receivedAt.current);
      setElapsed(ms);
      if (ms >= round.limitMs && !busy.current && !pending) {
        void send({
          action: 'move',
          roundId: round.id,
          revision: round.revision,
          requestId: crypto.randomUUID(),
          move: { kind: 'sync' },
        });
      }
    }, 100);
    return () => window.clearInterval(timer);
  });
  function move(move: Move) {
    if (!round || pending || !active) return;
    void send({
      action: 'move',
      roundId: round.id,
      revision: round.revision,
      requestId: crypto.randomUUID(),
      move,
    });
  }
  return (
    <div className="online-layout">
      <section className="panel online-game">
        <span className="eyebrow">SHARED CHALLENGE / 在线比赛</span>
        <h1>一起排雷，全场竞速。</h1>
        <p>8 × 8 · 10 雷 · 180 秒。服务器发出对局即开始计时，包含网络往返时间。允许多次挑战。</p>
        <p className="muted">
          输入昵称即可匿名参赛，无需邮箱、手机号或密码。清除浏览器数据或更换设备可能丢失匿名身份；请保留当前浏览器领奖。
        </p>
        <a href="#display" target="_blank" rel="noreferrer">
          打开投影大屏 ↗
        </a>
        {!supabase ? (
          <p role="status">在线服务尚未配置。请继续使用扫雷终端的本地模式。</p>
        ) : (
          <>
            <div className="online-toolbar">
              <span>{session ? '匿名会话已恢复' : '尚未建立匿名会话'}</span>
              <a href="#awards">我的领奖凭证</a>
            </div>
            {!active && !pending && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setFlagMode(false);
                  void send({ action: 'start', name });
                }}
              >
                <label>
                  公开参赛昵称
                  <input
                    required
                    maxLength={32}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {!session && <Turnstile key={captchaReset} onToken={setCaptchaToken} />}
                <button
                  className="primary"
                  disabled={
                    working ||
                    (!session && captchaConfigured && !captchaToken) ||
                    !overview ||
                    !['open', 'closing'].includes(overview.state)
                  }
                >
                  {overview?.state === 'closing' ? '恢复当前对局' : '开始在线挑战'}
                </button>
              </form>
            )}
            {!round && !pending && (
              <p className="muted">
                刷新后输入昵称可恢复当前浏览器的未超时对局。每轮结束前 3
                分钟停止开新局。领奖以现场核验为准，匿名账号不能证明真实个人唯一。
              </p>
            )}
            {round && (
              <>
                <div className="game-metrics">
                  <div>
                    <span>{round.displayName} · 剩余时间</span>
                    <strong>
                      {(Math.max(0, round.limitMs - elapsed) / 1000).toFixed(1)}
                      <small> 秒</small>
                    </strong>
                  </div>
                  <div>
                    <span>服务器状态</span>
                    <strong className="online-status">
                      {
                        {
                          ready: '等待探索',
                          playing: '探索中',
                          won: '有效胜局，已入榜',
                          lost: '踩到土豆',
                          timeout: '已超时',
                        }[round.game.status]
                      }
                    </strong>
                  </div>
                </div>
                <fieldset
                  className="online-board-lock"
                  disabled={working || !!pending || !active}
                  aria-label="在线棋盘操作"
                >
                  <Board
                    game={round.game}
                    onReveal={(index) => move({ kind: 'reveal', index })}
                    onFlag={(index) => move({ kind: 'flag', index })}
                    flagMode={flagMode}
                    urls={urls}
                    settings={settings}
                  />
                </fieldset>
                <button aria-pressed={flagMode} onClick={() => setFlagMode(!flagMode)}>
                  ⚑ 在线插旗模式 {flagMode ? '开启' : '关闭'}
                </button>
                <p role="status">
                  {working
                    ? '正在等待服务器确认…'
                    : pending
                      ? '操作尚未确认，请重试。计时继续。'
                      : '每次翻格和成绩均由服务器验证。'}
                </p>
              </>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {pending && !working && (
          <div className="online-toolbar">
            <button className="primary" onClick={() => void send(pending)}>
              重试上次请求
            </button>
            <button
              onClick={() => {
                setRound(null);
                setPending(null);
                setError('');
              }}
            >
              重新连接对局
            </button>
          </div>
        )}
      </section>
      <OnlineLeaderboard onOverview={setOverview} />
    </div>
  );
}
