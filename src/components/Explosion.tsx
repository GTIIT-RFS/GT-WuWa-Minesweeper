import { useEffect, useState, type CSSProperties } from 'react';
import type { Settings } from '../storage/settings';
import { DEFAULT_MASCOT } from '../storage/defaultAssets';
import { AssetImage } from './AssetImage';

/** One short, deterministic burst. Settings edits apply to the next preview, not mid-animation. */
export function Explosion({
  settings,
  urls,
  onDone,
}: {
  settings: Settings;
  urls: Record<string, string>;
  onDone: () => void;
}) {
  const [e] = useState(() => ({ ...settings.effects }));
  const reduced = e.reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 650 : e.duration;
  // Keep each animation inside the requested total time, including particle stagger.
  const burstDuration = Math.max(180, duration - 240);
  useEffect(() => {
    const timer = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDone]);
  return (
    <div
      className={`explosion preset-${e.preset} ${reduced ? 'reduced' : ''}`}
      role="status"
      aria-label="土豆爆炸动画"
      style={
        {
          '--duration': `${duration}ms`,
          '--burst-duration': `${burstDuration}ms`,
          '--burst-color': e.color,
          '--potato-scale': e.scale,
        } as CSSProperties
      }
    >
      <div className="explosion-stage" aria-hidden="true">
        <div className="warning-ring" />
        <div className="impact-glow" />
        <div className="shockwave" />
        <div className="shockwave shockwave-echo" />
        {!reduced &&
          Array.from({ length: Math.min(80, e.count) }, (_, i) => {
            const angle = i * 2.39996;
            const distance = (100 + (i % 7) * 30) * e.speed * (e.preset === 'super' ? 1.2 : 1);
            const rain = e.preset === 'rain';
            const x = rain ? (((i * 73) % 101) - 50) * 7 : Math.cos(angle) * distance;
            const y = rain ? 240 + (i % 7) * 45 : Math.sin(angle) * distance;
            return (
              <span
                key={i}
                className={`particle ${rain ? 'potato-particle' : i % 3 === 0 ? 'particle-streak' : ''}`}
                style={
                  {
                    '--dx': `${x}px`,
                    '--dy': `${y}px`,
                    '--start-x': `${rain ? x * 0.8 : 0}px`,
                    '--start-y': `${rain ? -250 - (i % 5) * 26 : 0}px`,
                    '--spin': `${(i % 2 ? -1 : 1) * (120 + i * 23)}deg`,
                    '--particle-size': `${4 + (i % 5) * 2}px`,
                    animationDelay: `${180 + (i % 4) * 15}ms`,
                  } as CSSProperties
                }
              >
                {rain && <img src={urls.mine || DEFAULT_MASCOT} alt="" draggable={false} />}
              </span>
            );
          })}
        <div className="explosion-potato">
          <AssetImage
            asset="explosion"
            urls={urls}
            settings={settings}
            fallback={urls.mine || DEFAULT_MASCOT}
          />
        </div>
      </div>
      <strong className="boom-word">
        BOOM<span>检测到超量土豆能量</span>
      </strong>
    </div>
  );
}
