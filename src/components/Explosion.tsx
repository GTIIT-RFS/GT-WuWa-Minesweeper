import { useEffect, type CSSProperties } from 'react';
import type { Settings } from '../storage/settings';
import { AssetImage } from './AssetImage';
export function Explosion({
  settings,
  urls,
  onDone,
}: {
  settings: Settings;
  urls: Record<string, string>;
  onDone: () => void;
}) {
  const e = settings.effects;
  const reduced = e.reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 650 : e.duration;
  useEffect(() => {
    const timer = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDone]);
  return (
    <div
      className={`explosion ${reduced ? 'reduced' : ''}`}
      role="status"
      aria-label="土豆爆炸动画"
      style={
        {
          '--duration': `${duration}ms`,
          '--burst-color': e.color,
          '--shake': `${e.shake}px`,
          '--potato-scale': e.scale,
        } as CSSProperties
      }
    >
      <div className="warning-ring" />
      <div className="shockwave" />
      {!reduced &&
        Array.from({ length: e.count }, (_, i) => {
          const angle = i * 2.39996,
            distance = (90 + (i % 7) * 34) * e.speed;
          return (
            <span
              key={i}
              className={`particle ${e.preset === 'rain' ? 'potato-particle' : ''}`}
              style={
                {
                  '--dx': `${Math.cos(angle) * distance}px`,
                  '--dy': `${Math.sin(angle) * distance}px`,
                  '--spin': `${i * 57}deg`,
                  animationDelay: `${(i % 4) * 35}ms`,
                } as CSSProperties
              }
            >
              {e.preset === 'rain' ? <img src={urls.mine || './potato.svg'} alt="" /> : ''}
            </span>
          );
        })}
      <div className="explosion-potato">
        <AssetImage
          asset="explosion"
          urls={urls}
          settings={settings}
          fallback={urls.mine || './potato.svg'}
        />
      </div>
      <strong className="boom-word">
        BOOM<span>检测到超量土豆能量</span>
      </strong>
    </div>
  );
}
