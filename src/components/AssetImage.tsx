import type { CSSProperties } from 'react';
import { DEFAULT_MASCOT, LEGACY_MASCOT } from '../storage/defaultAssets';
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
    <img
      alt=""
      draggable={false}
      decoding="async"
      className={`asset-image ${src === DEFAULT_MASCOT ? 'default-mascot' : ''} ${className}`}
      src={src}
      style={style}
      onError={(event) => {
        // Keep the legacy placeholder only as a one-shot fallback for the built-in mascot.
        if (src !== DEFAULT_MASCOT || event.currentTarget.dataset.fallback) return;
        event.currentTarget.dataset.fallback = 'true';
        event.currentTarget.src = LEGACY_MASCOT;
      }}
    />
  );
}
