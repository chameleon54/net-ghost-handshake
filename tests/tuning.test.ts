import { describe, expect, it } from 'vitest';
import { inputConfigDefaults } from '../src/config/input';
import { playerConfigDefaults } from '../src/config/player';
import { dummyConfigDefaults } from '../src/config/dummy';
import { rifleConfigDefaults } from '../src/config/rifle';
import {
  changedValues,
  inputFolder,
  playerFolders,
  dummyFolder,
  dummyKeysNotOnPanel,
  playerKeysNotOnPanel,
  rifleFolders,
  rifleKeysNotOnPanel,
  resetToDefaults,
  toCodeSnippet,
} from '../src/debug/tuning';

const playerSliders = playerFolders.flatMap((folder) => folder.sliders);

describe('the rifle tuning panel', () => {
  const sliders = rifleFolders.flatMap((folder) => folder.sliders);

  it('has a sensible range around every default, and every rifle value is listed or excluded on purpose', () => {
    for (const s of sliders) {
      expect(Object.keys(rifleConfigDefaults)).toContain(s.key);
      expect(s.min).toBeLessThan(s.max);
      expect(rifleConfigDefaults[s.key], s.key).toBeGreaterThanOrEqual(s.min);
      expect(rifleConfigDefaults[s.key], s.key).toBeLessThanOrEqual(s.max);
    }
    const onPanel = new Set<string>([...sliders.map((s) => s.key), ...rifleKeysNotOnPanel]);
    for (const key of Object.keys(rifleConfigDefaults)) expect(onPanel.has(key), `${key} is not on the panel`).toBe(true);
  });
});

describe('the dummy tuning panel', () => {
  it('has a sensible range around every default, and every dummy value is listed or excluded on purpose', () => {
    for (const s of dummyFolder.sliders) {
      expect(s.min).toBeLessThan(s.max);
      expect(dummyConfigDefaults[s.key], s.key).toBeGreaterThanOrEqual(s.min);
      expect(dummyConfigDefaults[s.key], s.key).toBeLessThanOrEqual(s.max);
    }
    const onPanel = new Set<string>([...dummyFolder.sliders.map((s) => s.key), ...dummyKeysNotOnPanel]);
    for (const key of Object.keys(dummyConfigDefaults)) expect(onPanel.has(key), `${key} is not on the panel`).toBe(true);
  });
});

describe('the tuning panel lists', () => {
  it('only keys that exist in the config, each once', () => {
    const keys = playerSliders.map((s) => s.key as string);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(Object.keys(playerConfigDefaults)).toContain(key);
    for (const s of inputFolder.sliders) expect(Object.keys(inputConfigDefaults)).toContain(s.key);
  });

  it('a default inside a sensible range, with a positive step, for every slider', () => {
    const check = (key: string, value: number, s: { min: number; max: number; step: number }) => {
      expect(s.min, key).toBeLessThan(s.max);
      expect(s.step, key).toBeGreaterThan(0);
      expect(value, `${key} default ${value}`).toBeGreaterThanOrEqual(s.min);
      expect(value, `${key} default ${value}`).toBeLessThanOrEqual(s.max);
    };
    for (const s of playerSliders) check(s.key, playerConfigDefaults[s.key], s);
    for (const s of inputFolder.sliders) check(s.key, inputConfigDefaults[s.key], s);
  });

  it('every player value, so a new config value cannot be forgotten (or it is excluded on purpose)', () => {
    const onPanel = new Set<string>([...playerSliders.map((s) => s.key), ...playerKeysNotOnPanel]);
    for (const key of Object.keys(playerConfigDefaults)) expect(onPanel.has(key), `${key} is not on the panel`).toBe(true);
    for (const key of Object.keys(inputConfigDefaults)) {
      expect(inputFolder.sliders.map((s) => s.key as string), key).toContain(key);
    }
  });
});

describe('changedValues, resetToDefaults and toCodeSnippet', () => {
  const defaults = { walkMps: 4, leanM: 0.45, slideSec: 0.7 };

  it('finds only the values that differ', () => {
    expect(changedValues({ walkMps: 8, leanM: 0.45, slideSec: 0.7 }, defaults)).toEqual({ walkMps: 8 });
    expect(changedValues({ ...defaults }, defaults)).toEqual({});
  });

  it('reset puts every value back', () => {
    const live = { walkMps: 8, leanM: 0.6, slideSec: 1.5 };
    resetToDefaults(live, defaults);
    expect(live).toEqual(defaults);
  });

  it('writes the changed values in the config files format, per file', () => {
    const text = toCodeSnippet({ moveSpeedMps: 8, leanRollRad: 0.2 }, { mouseSensitivityRadPerPx: 0.003 });
    expect(text).toContain('// src/config/player.ts');
    expect(text).toContain('moveSpeedMps: 8,');
    expect(text).toContain('leanRollRad: 0.2,');
    expect(text).toContain('// src/config/input.ts');
    expect(text).toContain('mouseSensitivityRadPerPx: 0.003,');
  });

  it('says so when nothing changed, and does not show float noise', () => {
    expect(toCodeSnippet({}, {})).toContain('Nothing changed');
    expect(toCodeSnippet({ leanM: 0.1 + 0.2 }, {})).toContain('leanM: 0.3,');
  });
});
