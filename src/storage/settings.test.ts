import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings } from './settings';
describe('untrusted configuration import', () => {
  it('round-trips settings and validates image placement', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.placements.mine = { size: 125, x: 35, y: 50, opacity: 0.5 };
    expect(validateSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('rejects malformed, unsafe and out-of-bounds settings', () => {
    for (const invalid of [
      null,
      {},
      { ...DEFAULT_SETTINGS, limit: -10 },
      { ...DEFAULT_SETTINGS, volume: 50 },
      { ...DEFAULT_SETTINGS, effects: { ...DEFAULT_SETTINGS.effects, count: 1e9 } },
      {
        ...DEFAULT_SETTINGS,
        effects: { ...DEFAULT_SETTINGS.effects, color: 'url(https://external.test)' },
      },
      { ...DEFAULT_SETTINGS, placements: { mine: { size: -2 } } },
    ])
      expect(() => validateSettings(invalid)).toThrow();
  });
});
