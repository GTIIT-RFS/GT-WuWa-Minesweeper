import type { CSSProperties } from 'react';
import type { Game } from '../game/engine';
import type { Settings } from '../storage/settings';
import { AssetImage } from './AssetImage';
export function Board({
  game,
  onReveal,
  onFlag,
  flagMode,
  urls,
  settings,
}: {
  game: Game;
  onReveal: (i: number) => void;
  onFlag: (i: number) => void;
  flagMode: boolean;
  urls: Record<string, string>;
  settings: Settings;
}) {
  const ended = !['ready', 'playing'].includes(game.status);
  return (
    <div className="board-scroll">
      <div
        className={`board ${game.status === 'lost' ? 'board-hit' : ''}`}
        style={{ '--cols': game.config.cols } as CSSProperties}
        aria-label="扫雷棋盘"
      >
        {game.cells.map((cell, i) => {
          const row = Math.floor(i / game.config.cols) + 1,
            col = (i % game.config.cols) + 1;
          const wrong = ended && cell.flagged && !cell.mine;
          const label = cell.revealed
            ? cell.mine
              ? '土豆'
              : `周围 ${cell.adjacent} 个土豆`
            : cell.flagged
              ? '已插旗'
              : '未翻开';
          return (
            <button
              key={i}
              className={`cell ${cell.revealed ? 'open' : ''} ${game.hit === i ? 'hit' : ''} n${cell.adjacent} ${wrong ? 'wrong' : ''}`}
              aria-label={`第${row}行第${col}列，${label}`}
              aria-disabled={ended || cell.revealed}
              onClick={() => (flagMode ? onFlag(i) : onReveal(i))}
              onContextMenu={(e) => {
                e.preventDefault();
                onFlag(i);
              }}
            >
              <AssetImage
                asset={cell.revealed ? 'revealed' : 'covered'}
                urls={urls}
                settings={settings}
              />
              <span className="cell-content">
                {cell.revealed ? (
                  cell.mine ? (
                    <AssetImage
                      asset="mine"
                      urls={urls}
                      settings={settings}
                      fallback="./potato.svg"
                    />
                  ) : (
                    cell.adjacent || ''
                  )
                ) : cell.flagged ? (
                  urls.flag ? (
                    <AssetImage asset="flag" urls={urls} settings={settings} />
                  ) : (
                    '⚑'
                  )
                ) : (
                  <span className="cell-mark">✦</span>
                )}
                {wrong && <span className="wrong-mark">×</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
