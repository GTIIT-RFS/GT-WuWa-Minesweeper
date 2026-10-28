import { DEFAULT_MASCOT } from './storage/defaultAssets';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  createGame,
  expire,
  PRESETS,
  reveal,
  toggleFlag,
  validateConfig,
  type BoardConfig,
  type Game,
} from './game/engine';
import {
  loadScores,
  loadSettings,
  saveJson,
  SCORES_KEY,
  SETTINGS_KEY,
  type Score,
  type Settings,
} from './storage/settings';
import { readAssets, validateMedia, writeAsset, type SoundKey } from './storage/assets';
import { playSound } from './audio/controller';
import { AssetImage } from './components/AssetImage';
import { Board } from './components/Board';
import { Explosion } from './components/Explosion';
import { AdminPanel } from './components/AdminPanel';
import { Leaderboard } from './components/Leaderboard';
import { OnlineCompetition } from './components/OnlineCompetition';
import { OnlineLeaderboard } from './components/OnlineLeaderboard';
import { AwardWallet } from './components/AwardWallet';
import { EventAdmin } from './components/EventAdmin';

type View = 'menu' | 'game' | 'scores' | 'admin' | 'online' | 'display' | 'awards' | 'event-admin';
const hashView = (): View =>
  ['online', 'display', 'awards', 'event-admin'].includes(location.hash.slice(1).split('?')[0])
    ? (location.hash.slice(1).split('?')[0] as View)
    : 'menu';
export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [scores, setScores] = useState(loadScores);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlRef = useRef<Record<string, string>>({});
  const [view, setView] = useState<View>(hashView);
  useEffect(() => {
    const onHash = () => navigate(hashView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });
  const [difficulty, setDifficulty] = useState('normal');
  const [custom, setCustom] = useState<BoardConfig>({ rows: 8, cols: 8, mines: 10 });
  const [name, setName] = useState('');
  const [game, setGame] = useState(() => createGame(PRESETS.normal));
  const gameRef = useRef(game);
  const [flagMode, setFlagMode] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef<number | null>(null);
  const round = useRef({
    timed: settings.timed,
    limit: settings.limit,
    difficulty: '普通模式',
    name: '匿名共鸣者',
  });
  const [explosion, setExplosion] = useState<number | null>(null);
  const explosionCounter = useRef(0);
  const [error, setError] = useState('');
  const [assetsReady, setAssetsReady] = useState(false);
  const endExplosion = useCallback(() => setExplosion(null), []);
  const sound = useCallback(
    (key: SoundKey) => playSound(key, urlRef.current, settings.volume, settings.muted),
    [settings.volume, settings.muted],
  );
  useEffect(() => {
    let disposed = false;
    void readAssets()
      .then((files) => {
        if (disposed) return;
        const next: Record<string, string> = {};
        for (const [key, blob] of Object.entries(files)) next[key] = URL.createObjectURL(blob);
        urlRef.current = next;
        setUrls(next);
      })
      .catch((e) => {
        if (!disposed) setError((e as Error).message);
      })
      .finally(() => {
        if (!disposed) setAssetsReady(true);
      });
    return () => {
      disposed = true;
      Object.values(urlRef.current).forEach(URL.revokeObjectURL);
      urlRef.current = {};
    };
  }, []);
  function updateSettings(next: Settings) {
    try {
      saveJson(SETTINGS_KEY, next);
      setSettings(next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function updateAsset(key: string, file?: File) {
    if (file) await validateMedia(file, key.startsWith('audio:'));
    await writeAsset(key, file);
    const next = { ...urlRef.current };
    if (next[key]) URL.revokeObjectURL(next[key]);
    if (file) next[key] = URL.createObjectURL(file);
    else delete next[key];
    urlRef.current = next;
    setUrls(next);
  }
  function persistScores(next: Score[]) {
    setScores(next);
    try {
      saveJson(SCORES_KEY, next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // A single commit boundary records terminal transitions once, including the countdown path.
  function commit(next: Game) {
    const previous = gameRef.current;
    if (next === previous) return;
    gameRef.current = next;
    setGame(next);
    if (
      ['won', 'lost', 'timeout'].includes(next.status) &&
      ['ready', 'playing'].includes(previous.status)
    ) {
      const seconds = started.current === null ? 0 : (performance.now() - started.current) / 1000;
      const finalSeconds = round.current.timed ? Math.min(seconds, round.current.limit) : seconds;
      setElapsed(finalSeconds);
      if (settings.leaderboard)
        persistScores(
          [
            {
              id: crypto.randomUUID(),
              name: round.current.name,
              difficulty: round.current.difficulty,
              board: `${next.config.rows}×${next.config.cols} / ${next.config.mines} 雷`,
              won: next.status === 'won',
              seconds: finalSeconds,
              date: new Date().toISOString(),
              timed: round.current.timed,
              limit: round.current.limit,
            },
            ...scores,
          ].slice(0, 500),
        );
      if (next.status === 'lost') {
        sound('warning');
        setExplosion(++explosionCounter.current);
      } else sound(next.status === 'won' ? 'win' : 'timeout');
    }
  }
  useEffect(() => {
    if (game.status !== 'playing') return;
    const timer = window.setInterval(() => {
      if (started.current === null) return;
      const seconds = (performance.now() - started.current) / 1000;
      if (round.current.timed && seconds >= round.current.limit) commit(expire(gameRef.current));
      else setElapsed(seconds);
    }, 100);
    return () => window.clearInterval(timer);
    // Rebind on each render so the terminal commit uses current preferences and scores.
  });
  useEffect(() => {
    if (explosion === null) return;
    const timer = window.setTimeout(() => sound('boom'), 220);
    return () => window.clearTimeout(timer);
  }, [explosion, sound]);
  function start() {
    try {
      const config = difficulty === 'custom' ? custom : PRESETS[difficulty as keyof typeof PRESETS];
      validateConfig(config);
      const next = createGame(config);
      gameRef.current = next;
      setGame(next);
      round.current = {
        timed: settings.timed,
        limit: settings.limit,
        difficulty:
          difficulty === 'custom' ? '自定义' : PRESETS[difficulty as keyof typeof PRESETS].label,
        name: name.trim().slice(0, 16) || '匿名共鸣者',
      };
      started.current = null;
      setElapsed(0);
      setFlagMode(false);
      setExplosion(null);
      setError('');
      setView('game');
      sound('click');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function beforeMove() {
    if (
      gameRef.current.status === 'playing' &&
      round.current.timed &&
      started.current !== null &&
      performance.now() - started.current >= round.current.limit * 1000
    ) {
      commit(expire(gameRef.current));
      return false;
    }
    return true;
  }
  function open(index: number) {
    if (!beforeMove()) return;
    const next = reveal(gameRef.current, index);
    if (next !== gameRef.current) {
      if (started.current === null) started.current = performance.now();
      if (next.status !== 'lost' && next.status !== 'won') sound('reveal');
      commit(next);
    }
  }
  function flag(index: number) {
    if (!beforeMove()) return;
    const next = toggleFlag(gameRef.current, index);
    if (next !== gameRef.current) {
      sound('flag');
      commit(next);
    }
  }
  function navigate(next: View) {
    if (gameRef.current.status === 'playing' && view === 'game') {
      if (!confirm('离开将结束当前对局，且不会记录这局成绩。确定离开？')) {
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        return;
      }
      const reset = createGame(game.config);
      gameRef.current = reset;
      setGame(reset);
      started.current = null;
      setElapsed(0);
    }
    // Hash routes work on GitHub Pages without server rewrites.
    // Keep a private claim fragment until EventAdmin reads and removes it on mount.
    const fragment =
      next === 'event-admin' && location.hash.startsWith('#event-admin?')
        ? location.hash
        : ['online', 'display', 'awards', 'event-admin'].includes(next)
          ? `#${next}`
          : '';
    history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`);
    setView(next);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError('当前浏览器不支持全屏，请使用浏览器的全屏功能。');
    }
  }
  const terminal = ['won', 'lost', 'timeout'].includes(game.status);
  const remaining = game.config.mines - game.cells.filter((c) => c.flagged).length;
  const revealed = game.cells.filter((c) => c.revealed && !c.mine).length;
  const progress = (revealed / (game.cells.length - game.config.mines)) * 100;
  const statusText = {
    ready: '等待首次探索',
    playing: '探索进行中',
    won: '安全区域已清空',
    lost: '检测到土豆爆炸',
    timeout: '挑战时间已结束',
  }[game.status];
  return (
    <div
      className={`app ${view === 'display' ? 'projection-mode' : ''} ${settings.effects.reduced ? 'reduce-motion' : ''} ${explosion !== null ? 'is-exploding' : ''}`}
      style={{ '--screen-shake': `${settings.effects.shake}px` } as CSSProperties}
    >
      <div className="background-asset">
        <AssetImage asset="background" urls={urls} settings={settings} />
      </div>
      <div className="ambient-grid" aria-hidden="true" />
      <header className="site-header">
        <button className="brand" onClick={() => navigate('menu')} aria-label="GT WuWa 主菜单">
          <span className="brand-symbol">
            {urls.logo ? <AssetImage asset="logo" urls={urls} settings={settings} /> : 'W'}
          </span>
          <span>
            GT <b>WuWa</b>
            <small>RESONANCE CLUB · GTIIT</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <button
            aria-current={view === 'menu' || view === 'game' ? 'page' : undefined}
            onClick={() => navigate('menu')}
          >
            扫雷终端
          </button>
          <button
            aria-current={view === 'scores' ? 'page' : undefined}
            onClick={() => navigate('scores')}
          >
            排行榜
          </button>
          <button
            aria-current={view === 'online' ? 'page' : undefined}
            onClick={() => navigate('online')}
          >
            在线比赛
          </button>
          <button
            className="icon-button"
            onClick={() => updateSettings({ ...settings, muted: !settings.muted })}
            aria-label={settings.muted ? '开启声音' : '静音'}
          >
            {settings.muted ? '♫ OFF' : '♫ ON'}
          </button>
          <button className="icon-button" onClick={() => void fullscreen()} aria-label="切换全屏">
            ⛶
          </button>
        </nav>
      </header>
      <main>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError('')} aria-label="关闭提示">
              ×
            </button>
          </div>
        )}
        {(view === 'menu' || view === 'game') && (
          <>
            <div className="intro">
              <div>
                <span className="eyebrow">
                  <span className="live-dot" /> GT WUWA / 社团之夜特别企划
                </span>
                <h1>
                  扫雷，但是爆的是
                  <span>
                    土豆<span className="title-dot">.</span>
                  </span>
                </h1>
                <p>你永远不知道下一格会不会爆出土豆。</p>
              </div>
              <div className="edition">
                <span>FIELD TEST</span>
                <b>001 / POTATO</b>
                <small>安全探索 · 小心土豆</small>
              </div>
            </div>
            <div className="play-layout">
              <aside className="left-column">
                <section className="panel mission">
                  <span className="eyebrow">MISSION BRIEF / 任务简报</span>
                  <h2>
                    一点运气，
                    <br />
                    加一点推理。
                  </h2>
                  <p className="muted">
                    翻开安全区域，避开潜伏的土豆。
                    <br />
                    清空全部安全格，即可完成挑战。
                  </p>
                  <div className="mission-potato">
                    <AssetImage
                      asset="decoration"
                      urls={urls}
                      settings={settings}
                      fallback={urls.mine || DEFAULT_MASCOT}
                    />
                    <span className="orbit orbit-one" />
                    <span className="orbit orbit-two" />
                    <span className="potato-tag">POTATO-01</span>
                  </div>
                  <div className="mission-spec">
                    <span>危险等级</span>
                    <b>可爱，但致命</b>
                  </div>
                </section>
                <section className="panel how-to">
                  <span className="eyebrow">HOW TO PLAY</span>
                  <ol>
                    <li>
                      <b>01</b>
                      <span>
                        <strong>点击探索</strong>
                        <small>首格必定安全，放心迈出第一步。</small>
                      </span>
                    </li>
                    <li>
                      <b>02</b>
                      <span>
                        <strong>数字就是线索</strong>
                        <small>数字代表周围 8 格的土豆数量。</small>
                      </span>
                    </li>
                    <li>
                      <b>03</b>
                      <span>
                        <strong>标记可疑土豆</strong>
                        <small>右键插旗；触屏请开启插旗模式。</small>
                      </span>
                    </li>
                  </ol>
                </section>
              </aside>
              <section className="panel game-terminal">
                <div className="terminal-heading">
                  <span>
                    <span className="live-dot" /> POTATO SWEEPER
                  </span>
                  <small>本地运行 / 无需联网</small>
                </div>
                {view === 'menu' ? (
                  <div className="menu-content">
                    <span className="eyebrow">SELECT YOUR MISSION</span>
                    <h2>准备好探索了吗？</h2>
                    <p className="muted">选择一项挑战，开启你的土豆排雷任务。</p>
                    <div className="difficulty-list">
                      {Object.entries(PRESETS).map(([id, p], i) => (
                        <button
                          key={id}
                          className={difficulty === id ? 'selected' : ''}
                          aria-pressed={difficulty === id}
                          onClick={() => setDifficulty(id)}
                        >
                          <span className="difficulty-icon">{['◇', '◈', '✦'][i]}</span>
                          <span>
                            <strong>{p.label}</strong>
                            <small>
                              {p.rows} × {p.cols} 棋盘 · {p.mines} 颗土豆
                            </small>
                          </span>
                          <span className="difficulty-note">
                            {['轻松入门', '经典挑战', '高能预警'][i]}
                          </span>
                          <span className="radio-dot" />
                        </button>
                      ))}
                      <button
                        className={difficulty === 'custom' ? 'selected' : ''}
                        aria-pressed={difficulty === 'custom'}
                        onClick={() => setDifficulty('custom')}
                      >
                        <span className="difficulty-icon">＋</span>
                        <span>
                          <strong>自定义模式</strong>
                          <small>自己定义这场冒险</small>
                        </span>
                        <span className="radio-dot" />
                      </button>
                    </div>
                    {difficulty === 'custom' && (
                      <div className="custom-inputs">
                        {(['rows', 'cols', 'mines'] as const).map((key, i) => (
                          <label key={key}>
                            {['行数', '列数', '土豆数'][i]}
                            <input
                              type="number"
                              min={key === 'mines' ? 1 : 3}
                              max={key === 'mines' ? custom.rows * custom.cols - 1 : 20}
                              value={custom[key]}
                              onChange={(e) => setCustom({ ...custom, [key]: +e.target.value })}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    <label className="nickname">
                      共鸣者昵称 <span>可选 · 最多 16 字</span>
                      <input
                        placeholder="留下你的代号"
                        maxLength={16}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <button className="primary start-button" onClick={start}>
                      开始挑战 <span>↗</span>
                    </button>
                    <p className="start-footnote">
                      {settings.timed ? `◷ 活动限时 ${settings.limit} 秒` : '◷ 自由计时'}
                      <span>✧ 首次点击安全保护</span>
                    </p>
                  </div>
                ) : (
                  <div className="game-content">
                    <div className="game-metrics">
                      <div>
                        <span>待标记土豆</span>
                        <strong>
                          {String(remaining).padStart(2, '0')}
                          <small>颗</small>
                        </strong>
                      </div>
                      <div>
                        <span>{round.current.timed ? '剩余时间' : '探索用时'}</span>
                        <strong>
                          {(round.current.timed
                            ? Math.max(0, round.current.limit - elapsed)
                            : elapsed
                          ).toFixed(1)}
                          <small>秒</small>
                        </strong>
                      </div>
                      <button onClick={start} aria-label="重新开始">
                        ↻<small>重新开始</small>
                      </button>
                    </div>
                    <div className="board-meta">
                      <span>
                        {round.current.difficulty} / {game.config.rows} × {game.config.cols}
                      </span>
                      <span role="status">{statusText}</span>
                    </div>
                    <Board
                      game={game}
                      onReveal={open}
                      onFlag={flag}
                      flagMode={flagMode}
                      urls={urls}
                      settings={settings}
                    />
                    <div className="board-actions">
                      <button
                        className={flagMode ? 'active' : ''}
                        aria-pressed={flagMode}
                        onClick={() => setFlagMode(!flagMode)}
                      >
                        ⚑ 插旗模式 {flagMode ? '开启' : '关闭'}
                      </button>
                      <small>{flagMode ? '点击方格来插旗或取消旗帜' : '点击翻格 · 右键插旗'}</small>
                    </div>
                    <div className="progress-track">
                      <div style={{ width: `${progress}%` }} />
                    </div>
                    <div className="progress-label">
                      <span>安全区域探索进度</span>
                      <b>{Math.round(progress)}%</b>
                    </div>
                    {terminal && explosion === null && (
                      <section className={`result ${game.status}`} role="status">
                        <div className="result-art">
                          <AssetImage
                            asset={game.status === 'won' ? 'victory' : 'defeat'}
                            urls={urls}
                            settings={settings}
                            fallback={DEFAULT_MASCOT}
                          />
                        </div>
                        <span className="eyebrow">
                          {game.status === 'won' ? 'MISSION COMPLETE' : 'MISSION ENDED'}
                        </span>
                        <h2>
                          {game.status === 'won'
                            ? '漂亮！安全撤离！'
                            : game.status === 'lost'
                              ? 'BOOM！你踩到土豆了！'
                              : '时间到！土豆赢了这一局'}
                        </h2>
                        <p>
                          本次{game.status === 'won' ? '完成' : '存活'}时间：{elapsed.toFixed(1)} 秒
                        </p>
                        <div>
                          <button className="primary" onClick={start}>
                            再来一次
                          </button>
                          <button onClick={() => setView('menu')}>返回主菜单</button>
                        </div>
                      </section>
                    )}
                  </div>
                )}
                <div className="terminal-bottom">
                  <span>● SYSTEM ONLINE</span>
                  <span>GTIIT · GT WUWA</span>
                </div>
              </section>
            </div>
          </>
        )}
        {view === 'scores' && (
          <Leaderboard
            scores={scores}
            onClear={() => persistScores([])}
            onClose={() => setView('menu')}
          />
        )}
        {view === 'online' && (
          <OnlineCompetition
            settings={settings}
            urls={urls}
            sound={sound}
            onExplosion={() => setExplosion(++explosionCounter.current)}
          />
        )}
        {view === 'display' && <OnlineLeaderboard display />}
        {view === 'awards' && <AwardWallet />}
        {view === 'event-admin' && <EventAdmin />}
        {view === 'admin' &&
          (assetsReady ? (
            <AdminPanel
              settings={settings}
              urls={urls}
              onSettings={updateSettings}
              onAsset={updateAsset}
              onTest={() => setExplosion(++explosionCounter.current)}
              onSound={sound}
              onClose={() => setView('menu')}
            />
          ) : (
            <p role="status">正在读取素材库…</p>
          ))}
      </main>
      <footer>
        <span>
          GT WuWa <i>/</i> 用一点推理，换一晚快乐。
        </span>
        <span>
          本机独立保存 <button onClick={() => navigate('admin')}>⚙ 管理员设置</button>
          <button onClick={() => navigate('event-admin')}>赛事后台</button>
        </span>
      </footer>
      {explosion !== null && (
        <Explosion key={explosion} settings={settings} urls={urls} onDone={endExplosion} />
      )}
    </div>
  );
}
