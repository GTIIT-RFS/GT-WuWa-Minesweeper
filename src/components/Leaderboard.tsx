import { useState } from 'react';
import type { Score } from '../storage/settings';
export function Leaderboard({
  scores,
  onClear,
  onClose,
}: {
  scores: Score[];
  onClear: () => void;
  onClose: () => void;
}) {
  const groups = [
    ...new Set(scores.filter((s) => s.won).map((s) => `${s.board}|${s.timed ? s.limit : 0}`)),
  ];
  const [group, setGroup] = useState(groups[0] || '');
  const ranked = scores
    .filter((s) => s.won && `${s.board}|${s.timed ? s.limit : 0}` === group)
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 50);
  return (
    <section className="panel leaderboard">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LOCAL RECORDS</span>
          <h2>共鸣者排行榜</h2>
        </div>
        <button onClick={onClose}>返回游戏</button>
      </div>
      <p className="muted">同一棋盘与计时规则独立排名 · 只计胜利 · 本机最近 500 局</p>
      <label>
        排名组别
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {groups.map((g) => {
            const [board, limit] = g.split('|');
            return (
              <option key={g} value={g}>
                {board} · {limit === '0' ? '自由计时' : `${limit} 秒限时`}
              </option>
            );
          })}
        </select>
      </label>
      {!ranked.length ? (
        <div className="empty-state">
          ✦<h3>第一位共鸣者，会是你吗？</h3>
          <p>完成一局胜利，点亮你的记录。</p>
        </div>
      ) : (
        <ol className="score-list">
          {ranked.map((s, i) => (
            <li key={s.id}>
              <span className="rank">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.difficulty} · {new Date(s.date).toLocaleString('zh-CN')}
                </small>
              </div>
              <b>
                {s.seconds.toFixed(1)}
                <small>秒</small>
              </b>
            </li>
          ))}
        </ol>
      )}
      <details>
        <summary>全部对局记录（包括未获胜）</summary>
        <ul className="history">
          {scores.map((s) => (
            <li key={s.id}>
              {s.name} · {s.board} · {s.won ? '胜利' : '未获胜'} · {s.seconds.toFixed(1)} 秒 ·{' '}
              {new Date(s.date).toLocaleString('zh-CN')}
            </li>
          ))}
        </ul>
      </details>
      <button
        className="danger"
        onClick={() => {
          if (confirm('清空本机所有成绩？此操作不可撤销。')) {
            onClear();
            setGroup('');
          }
        }}
      >
        清空排行榜
      </button>
    </section>
  );
}
