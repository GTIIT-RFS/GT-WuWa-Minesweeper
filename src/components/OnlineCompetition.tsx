import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { PublicRound, Move } from '../../supabase/functions/_shared/competition';
import { competitionRequest, RequestError, supabase, type OnlineRequest } from '../online/client';
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
  testMode = false,
}: {
  settings: Settings;
  urls: Record<string, string>;
  sound: (key: SoundKey) => void;
  onExplosion: () => void;
  testMode?: boolean;
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
  const [identityInvalid, setIdentityInvalid] = useState(false);
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
    if (body.action === 'start') {
      try {
        displayName(body.name);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    busy.current = true;
    setWorking(true);
    setError('');
    setPending(body);
    try {
      if (body.action === 'start') {
        const restored = await ensureAnonymousSession(captchaToken || undefined).catch((e) => {
          setPending(null);
          throw e;
        });
        setSession(restored);
      }
      const next = await competitionRequest(body, testMode);
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
      if (e instanceof RequestError && e.status === 401) setIdentityInvalid(true);
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
  const pendingMove =
    pending?.action === 'move' &&
    typeof pending.move.index === 'number' &&
    (pending.move.kind === 'reveal' || pending.move.kind === 'flag')
      ? {
          index: pending.move.index,
          kind: pending.move.kind,
          retry: !working,
        }
      : null;
  let moveStatus = '每次翻格和成绩均由服务器验证。';
  if (pending) {
    moveStatus = pendingMove
      ? '操作未确认；标记仅表示待处理，请重试或重新连接。计时继续。'
      : '操作尚未确认，请重试。计时继续。';
  }
  if (working) {
    moveStatus = pendingMove ? '已标记本次操作，正在等待服务器确认…' : '正在等待服务器确认…';
  }
  return (
    <div className="online-layout">
      <section className="panel online-game">
        <span className="eyebrow">SHARED CHALLENGE / 在线比赛</span>
        <h1>{testMode ? '独立在线测试场' : '一起排雷，全场竞速。'}</h1>
        <p>
          {testMode
            ? '测试模式长期开放，用于验证在线对局、服务器计时、测试排行榜与测试领奖流程。'
            : '8 × 8 · 10 雷 · 180 秒。服务器发出对局即开始计时，包含网络往返时间。允许多次挑战。'}
        </p>
        {testMode && (
          <p className="test-mode-notice">
            测试成绩、排名、结算与领奖记录均独立保存，不会进入正式排行榜或产生正式领奖资格。
          </p>
        )}
        <p>
          <a href={testMode ? '#online' : '#online-test'}>
            {testMode ? '返回正式比赛 ↗' : '进入独立在线测试场 ↗'}
          </a>
        </p>
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
              <a href={testMode ? '#test-awards' : '#awards'}>
                {testMode ? '我的测试领奖凭证' : '我的领奖凭证'}
              </a>
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
                  {testMode
                    ? overview?.state === 'closing'
                      ? '恢复测试对局'
                      : '开始测试对局'
                    : overview?.state === 'closing'
                      ? '恢复当前对局'
                      : '开始在线挑战'}
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
                    pendingMove={pendingMove}
                  />
                </fieldset>
                <button aria-pressed={flagMode} onClick={() => setFlagMode(!flagMode)}>
                  ⚑ 在线插旗模式 {flagMode ? '开启' : '关闭'}
                </button>
                <p role="status">{moveStatus}</p>
              </>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {identityInvalid && (
          <button
            disabled={working}
            onClick={() =>
              void (async () => {
                if (
                  !supabase ||
                  !confirm(
                    '先尝试刷新会话；若无法恢复，清理失效会话可能导致旧匿名身份及领奖资格无法找回。是否继续？',
                  )
                )
                  return;
                const { error } = await supabase.auth.refreshSession();
                if (error) await supabase.auth.signOut({ scope: 'local' });
                setIdentityInvalid(false);
                setPending(null);
                setRound(null);
                setError('已重新检查会话。若身份已丢失，请联系工作人员处理旧领奖记录。');
              })()
            }
          >
            修复失效匿名会话
          </button>
        )}
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
      <OnlineLeaderboard onOverview={setOverview} testMode={testMode} />
    </div>
  );
}
