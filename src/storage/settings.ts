export const ASSET_LABELS = {
  background: '整体背景',
  logo: '社团 Logo',
  decoration: '主界面装饰',
  covered: '未翻开方格',
  revealed: '已翻开方格',
  mine: '土豆地雷',
  flag: '插旗图标',
  explosion: '爆炸主图',
  victory: '胜利图片',
  defeat: '失败图片',
} as const;
export type AssetKey = keyof typeof ASSET_LABELS;
export interface Placement {
  size: number;
  x: number;
  y: number;
  opacity: number;
}
export const DEFAULT_PLACEMENT: Placement = { size: 100, x: 50, y: 50, opacity: 1 };
export interface Effects {
  preset: string;
  duration: number;
  count: number;
  speed: number;
  color: string;
  scale: number;
  shake: number;
  reduced: boolean;
}
export const EFFECT_PRESETS: Record<string, Effects> = {
  classic: {
    preset: 'classic',
    duration: 1800,
    count: 32,
    speed: 1,
    color: '#f5bd73',
    scale: 1,
    shake: 5,
    reduced: false,
  },
  rain: {
    preset: 'rain',
    duration: 2400,
    count: 48,
    speed: 1.2,
    color: '#88dfd1',
    scale: 0.85,
    shake: 3,
    reduced: false,
  },
  super: {
    preset: 'super',
    duration: 2600,
    count: 64,
    speed: 1.5,
    color: '#ffd780',
    scale: 1.4,
    shake: 9,
    reduced: false,
  },
  minimal: {
    preset: 'minimal',
    duration: 800,
    count: 0,
    speed: 0,
    color: '#88dfd1',
    scale: 0.8,
    shake: 0,
    reduced: true,
  },
};
export interface Settings {
  version: 1;
  limit: number;
  timed: boolean;
  leaderboard: boolean;
  muted: boolean;
  volume: number;
  effects: Effects;
  placements: Partial<Record<AssetKey, Placement>>;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  limit: 90,
  timed: false,
  leaderboard: true,
  muted: false,
  volume: 0.3,
  effects: EFFECT_PRESETS.classic,
  placements: {},
};
export const SETTINGS_KEY = 'gt-wuwa:settings:v1';
export const SCORES_KEY = 'gt-wuwa:scores:v1';
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') throw new Error('配置文件无效。');
  const s = raw as Settings,
    e = s.effects;
  if (
    s.version !== 1 ||
    !finite(s.limit, 10, 3600) ||
    !Number.isInteger(s.limit) ||
    typeof s.timed !== 'boolean' ||
    typeof s.leaderboard !== 'boolean' ||
    typeof s.muted !== 'boolean' ||
    !finite(s.volume, 0, 1) ||
    !e ||
    !Object.hasOwn(EFFECT_PRESETS, e.preset) ||
    !finite(e.duration, 500, 4000) ||
    !finite(e.count, 0, 80) ||
    !Number.isInteger(e.count) ||
    !finite(e.speed, 0, 2) ||
    !finite(e.scale, 0.5, 1.5) ||
    !finite(e.shake, 0, 10) ||
    typeof e.reduced !== 'boolean' ||
    !/^#[0-9a-f]{6}$/i.test(e.color) ||
    !s.placements ||
    typeof s.placements !== 'object'
  )
    throw new Error('配置格式或参数范围无效。');
  const placements: Settings['placements'] = {};
  for (const key of Object.keys(ASSET_LABELS) as AssetKey[]) {
    const p = s.placements[key];
    if (p) {
      if (
        !finite(p.size, 25, 200) ||
        !finite(p.x, 0, 100) ||
        !finite(p.y, 0, 100) ||
        !finite(p.opacity, 0.1, 1)
      )
        throw new Error('素材布局配置无效。');
      placements[key] = { size: p.size, x: p.x, y: p.y, opacity: p.opacity };
    }
  }
  return {
    version: 1,
    limit: s.limit,
    timed: s.timed,
    leaderboard: s.leaderboard,
    muted: s.muted,
    volume: s.volume,
    effects: {
      preset: e.preset,
      duration: e.duration,
      count: e.count,
      speed: e.speed,
      scale: e.scale,
      shake: e.shake,
      reduced: e.reduced,
      color: e.color,
    },
    placements,
  };
}
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? validateSettings(JSON.parse(raw)) : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}
export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('浏览器存储不可用或已满，本次修改无法保存。请检查浏览器设置。');
  }
}
export interface Score {
  id: string;
  name: string;
  difficulty: string;
  board: string;
  won: boolean;
  seconds: number;
  date: string;
  timed: boolean;
  limit: number;
}
export function loadScores(): Score[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]');
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(
        (s): s is Score =>
          s &&
          typeof s.id === 'string' &&
          typeof s.name === 'string' &&
          s.name.length <= 16 &&
          typeof s.board === 'string' &&
          typeof s.difficulty === 'string' &&
          typeof s.won === 'boolean' &&
          finite(s.seconds, 0, 86400) &&
          typeof s.date === 'string' &&
          !Number.isNaN(Date.parse(s.date)) &&
          typeof s.timed === 'boolean' &&
          finite(s.limit, 10, 3600),
      )
      .slice(0, 500);
  } catch {
    return [];
  }
}
