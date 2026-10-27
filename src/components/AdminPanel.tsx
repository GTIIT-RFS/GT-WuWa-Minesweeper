import { DEFAULT_MASCOT } from '../storage/defaultAssets';
import { useState, type ChangeEvent } from 'react';
import {
  ASSET_LABELS,
  DEFAULT_PLACEMENT,
  DEFAULT_SETTINGS,
  EFFECT_PRESETS,
  validateSettings,
  type AssetKey,
  type Settings,
} from '../storage/settings';
import { AUDIO_LABELS, type SoundKey } from '../storage/assets';
import { AssetImage } from './AssetImage';
interface Props {
  settings: Settings;
  urls: Record<string, string>;
  onSettings: (s: Settings) => void;
  onAsset: (key: string, file?: File) => Promise<void>;
  onTest: () => void;
  onSound: (key: SoundKey) => void;
  onClose: () => void;
}
export function AdminPanel({
  settings,
  urls,
  onSettings,
  onAsset,
  onTest,
  onSound,
  onClose,
}: Props) {
  const [tab, setTab] = useState('general');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<Settings>) => onSettings({ ...settings, ...p });
  const effect = (p: Partial<Settings['effects']>) =>
    patch({ effects: { ...settings.effects, ...p } });
  async function upload(key: string, file?: File) {
    setBusy(true);
    try {
      await onAsset(key, file);
      setMessage(file ? '素材已保存，立即生效。' : '已恢复默认素材。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importConfig(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('配置文件过大。');
      const next = validateSettings(JSON.parse(await file.text()));
      onSettings(next);
      setMessage('配置已导入。');
    } catch (error) {
      setMessage(`导入失败：${(error as Error).message}`);
    }
  }
  function exportConfig() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gt-wuwa-config.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="admin panel" aria-label="管理员设置">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CONTROL CENTER</span>
          <h2>活动控制台</h2>
        </div>
        <button onClick={onClose}>关闭设置 ×</button>
      </div>
      <p className="muted">
        本机配置 · 自动保存 · 此入口不是安全权限控制。活动限时设置在下一局生效。
      </p>
      <div className="tabs" role="tablist" aria-label="设置分类">
        {[
          ['general', '常规设置'],
          ['assets', '素材管理'],
          ['effects', '特效编辑器'],
          ['audio', '音效管理'],
        ].map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      <p role="status" className="notice">
        {message}
      </p>
      {tab === 'general' && (
        <div className="settings-grid">
          <div className="setting-card">
            <h3>社团活动</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.timed}
                onChange={(e) => patch({ timed: e.target.checked })}
              />
              开启限时模式
            </label>
            <label>
              挑战时长（10–3600 秒）
              <input
                type="number"
                min="10"
                max="3600"
                value={settings.limit}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isInteger(value) && value >= 10 && value <= 3600)
                    patch({ limit: value });
                }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.leaderboard}
                onChange={(e) => patch({ leaderboard: e.target.checked })}
              />
              记录本地成绩
            </label>
            <p className="muted">计时从第一次翻格开始；插旗不会消耗时间。</p>
          </div>
          <div className="setting-card">
            <h3>配置备份</h3>
            <p className="muted">
              JSON
              包含设置与素材布局，不包含图片、音频或排行榜。上传文件保存在当前浏览器，清理网站数据会删除它们。
            </p>
            <button onClick={exportConfig}>导出配置</button>
            <label className="upload-button">
              导入配置
              <input type="file" accept="application/json,.json" onChange={importConfig} />
            </label>
            <button
              className="danger"
              onClick={() => {
                if (confirm('恢复全部设置？已上传素材和成绩将保留。'))
                  onSettings(structuredClone(DEFAULT_SETTINGS));
              }}
            >
              恢复默认设置
            </button>
          </div>
        </div>
      )}
      {tab === 'assets' && (
        <>
          <p className="muted">
            支持 PNG / JPG / WebP / GIF，单张 ≤5
            MB。你的表情图可分别上传到「土豆地雷」和「爆炸主图」。
          </p>
          <div className="asset-grid">
            {(Object.entries(ASSET_LABELS) as [AssetKey, string][]).map(([key, label]) => {
              const p = settings.placements[key] || DEFAULT_PLACEMENT;
              const placement = (field: keyof typeof p, value: number) =>
                patch({ placements: { ...settings.placements, [key]: { ...p, [field]: value } } });
              return (
                <div className="setting-card" key={key}>
                  <h3>{label}</h3>
                  <div className="asset-preview">
                    <AssetImage
                      asset={key}
                      settings={settings}
                      urls={urls}
                      fallback={['mine', 'explosion'].includes(key) ? DEFAULT_MASCOT : undefined}
                    />
                    {!urls[key] && !['mine', 'explosion'].includes(key) && <span>默认界面</span>}
                  </div>
                  <label className="upload-button">
                    上传 / 替换{label}
                    <input
                      disabled={busy}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void upload(key, f);
                      }}
                    />
                  </label>
                  <button disabled={busy || !urls[key]} onClick={() => void upload(key)}>
                    恢复默认
                  </button>
                  <label>
                    大小 {p.size}%
                    <input
                      type="range"
                      min="25"
                      max="200"
                      value={p.size}
                      onChange={(e) => placement('size', +e.target.value)}
                    />
                  </label>
                  <label>
                    水平位置 {p.x}%
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={p.x}
                      onChange={(e) => placement('x', +e.target.value)}
                    />
                  </label>
                  <label>
                    垂直位置 {p.y}%
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={p.y}
                      onChange={(e) => placement('y', +e.target.value)}
                    />
                  </label>
                  <label>
                    透明度 {Math.round(p.opacity * 100)}%
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={p.opacity}
                      onChange={(e) => placement('opacity', +e.target.value)}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === 'effects' && (
        <>
          <div className="preset-buttons">
            {Object.entries({
              classic: '经典爆炸',
              rain: '土豆雨',
              super: '超级土豆爆炸',
              minimal: '极简模式',
            }).map(([id, label]) => (
              <button
                aria-pressed={settings.effects.preset === id}
                key={id}
                onClick={() => {
                  patch({ effects: { ...EFFECT_PRESETS[id] } });
                  onTest();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="settings-grid">
            <div className="setting-card">
              <h3>爆炸参数</h3>
              <p className="muted">
                滑动或直接输入数值。推荐 1.2–2.4 秒；手机建议不超过 48
                个粒子。参数保存后用于下一次爆炸。
              </p>
              {(
                [
                  {
                    key: 'duration',
                    label: '动画总时长',
                    unit: 'ms',
                    hint: '包含预警、爆炸和收尾，结束即显示结算。',
                    min: 500,
                    max: 4000,
                    step: 100,
                  },
                  {
                    key: 'count',
                    label: '粒子数量',
                    unit: '个',
                    hint: '越多越密集；土豆雨会将粒子替换为小土豆。',
                    min: 0,
                    max: 80,
                    step: 1,
                  },
                  {
                    key: 'speed',
                    label: '扩散距离 / 速度',
                    unit: '×',
                    hint: '控制粒子飞散范围，不增加动画时长。',
                    min: 0,
                    max: 2,
                    step: 0.1,
                  },
                  {
                    key: 'scale',
                    label: '主图大小',
                    unit: '×',
                    hint: '先迅速放大，再轻弹回落；最大值会更有冲击力。',
                    min: 0.5,
                    max: 1.5,
                    step: 0.1,
                  },
                  {
                    key: 'shake',
                    label: '屏幕轻震',
                    unit: 'px',
                    hint: '0 表示关闭。建议 2–6，震动仅持续 0.36 秒。',
                    min: 0,
                    max: 10,
                    step: 1,
                  },
                ] as const
              ).map((item) => (
                <div className="effect-field" key={item.key}>
                  <label htmlFor={`effect-${item.key}`}>
                    {item.label}
                    <output className="effect-value">
                      {settings.effects[item.key]} {item.unit}
                    </output>
                  </label>
                  <div className="effect-controls">
                    <input
                      id={`effect-${item.key}`}
                      aria-describedby={`hint-${item.key}`}
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={settings.effects[item.key]}
                      onChange={(e) => effect({ [item.key]: +e.target.value })}
                    />
                    <input
                      type="number"
                      aria-label={`${item.label}数值`}
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={settings.effects[item.key]}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (
                          event.target.value !== '' &&
                          Number.isFinite(value) &&
                          value >= item.min &&
                          value <= item.max &&
                          (item.step !== 1 || Number.isInteger(value))
                        )
                          effect({ [item.key]: value });
                      }}
                    />
                  </div>
                  <small className="effect-hint" id={`hint-${item.key}`}>
                    {item.hint}
                  </small>
                </div>
              ))}
              <label>
                粒子颜色
                <input
                  type="color"
                  value={settings.effects.color}
                  onChange={(e) => effect({ color: e.target.value })}
                />
              </label>
            </div>
            <div className="setting-card">
              <h3>预览与舒适度</h3>
              <p className="effect-summary">
                当前总时长 {(settings.effects.duration / 1000).toFixed(1)} 秒 ·{' '}
                {settings.effects.count} 个粒子
                <br />
                预设会立即预览；再次测试可从头播放。
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.effects.reduced}
                  onChange={(e) => effect({ reduced: e.target.checked })}
                />
                减少动态效果
              </label>
              <p className="muted">
                同时遵循系统的“减少动态效果”偏好，停用震动和粒子。所有动画仅在本机执行。
              </p>
              <button className="primary" onClick={onTest}>
                测试爆炸特效
              </button>
            </div>
          </div>
        </>
      )}
      {tab === 'audio' && (
        <>
          <div className="audio-toolbar">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.muted}
                onChange={(e) => patch({ muted: e.target.checked })}
              />
              静音
            </label>
            <label>
              音量 {Math.round(settings.volume * 100)}%
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.volume}
                onChange={(e) => patch({ volume: +e.target.value })}
              />
            </label>
          </div>
          <p className="muted">
            MP3 / WAV / OGG，单个 ≤10 MB。未上传时使用合成提示音；音频仅在操作后播放。
          </p>
          <div className="asset-grid">
            {(Object.entries(AUDIO_LABELS) as [SoundKey, string][]).map(([key, label]) => (
              <div className="setting-card" key={key}>
                <h3>{label}</h3>
                <p className="muted">
                  {urls[`audio:${key}`] ? '已使用自定义音效' : '默认合成音效'}
                </p>
                <label className="upload-button">
                  上传音效：{label}
                  <input
                    disabled={busy}
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void upload(`audio:${key}`, f);
                    }}
                  />
                </label>
                <button onClick={() => onSound(key)}>试听</button>
                <button
                  disabled={busy || !urls[`audio:${key}`]}
                  onClick={() => void upload(`audio:${key}`)}
                >
                  恢复默认
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
