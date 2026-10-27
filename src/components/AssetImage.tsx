import type { CSSProperties } from 'react';
import { DEFAULT_PLACEMENT, type AssetKey, type Settings } from '../storage/settings';
export function AssetImage({
  asset,
  urls,
  settings,
  fallback,
  className = '',
}: {
  asset: AssetKey;
  urls: Record<string, string>;
  settings: Settings;
  fallback?: string;
  className?: string;
}) {
  const src = urls[asset] || fallback;
  if (!src) return null;
  const p = settings.placements[asset] || DEFAULT_PLACEMENT;
  const style: CSSProperties = {
    width: `${p.size}%`,
    height: `${p.size}%`,
    left: `${p.x}%`,
    top: `${p.y}%`,
    opacity: p.opacity,
  };
  return (
    <img alt="" draggable={false} className={`asset-image ${className}`} src={src} style={style} />
  );
}
