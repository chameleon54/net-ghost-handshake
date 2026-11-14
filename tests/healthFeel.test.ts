import { afterEach, describe, expect, it } from 'vitest';
import { HealthSounds } from '../src/audio/healthSounds';
import type { SoundName } from '../src/audio/recipes';
import type { SoundPlayer } from '../src/audio/soundPlayer';
import { healthFx, healthFxDefaults } from '../src/config/healthFx';
import { healthFxFolders } from '../src/debug/tuning';
import { HealthFeelState, healthFeel } from '../src/player/healthFeel';
import { PlayerHealth } from '../src/player/playerHealth';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import { fillShare, readMagazine } from '../src/weapons/magazineFeel';

const dt = 1 / 60;

afterEach(() => {
  Object.assign(healthFx, healthFxDefaults);
});

describe('healthFeel', () => {
  it('shows nothing above 50', () => {
    for (const health of [100, 75, 51]) {
      expect(healthFeel(health), String(health)).toEqual({
        vignette: 0,
        drain: 0,
        heartbeatPerMin: 0,
        heartbeatVolume: 0,
        breathEverySec: 0,
        breathVolume: 0,
      });
    }
  });

  it('keeps a faint vignette at exactly 50 (where regeneration stops) but no sound', () => {
    const feel = healthFeel(50);
    expect(feel.vignette).toBeCloseTo(healthFxDefaults.vignetteStartStrength);
    expect(feel.drain).toBe(0);
    expect(feel.breathEverySec).toBe(0);
    expect(feel.heartbeatPerMin).toBe(0);
  });

  it('grows the vignette and the drain as health falls, never past their maximums', () => {
    expect(healthFeel(30).vignette).toBeGreaterThan(healthFeel(45).vignette);
    expect(healthFeel(10).vignette).toBeCloseTo(healthFxDefaults.vignetteMaxStrength);
    expect(healthFeel(1).vignette).toBeCloseTo(healthFxDefaults.vignetteMaxStrength);
    expect(healthFeel(35).drain).toBe(0);
    expect(healthFeel(20).drain).toBeGreaterThan(0);
    expect(healthFeel(5).drain).toBeCloseTo(healthFxDefaults.drainMax);
    expect(healthFeel(1).drain).toBeLessThanOrEqual(healthFxDefaults.drainMax);
  });

  it('breathes below 50, louder and quicker as health falls, and beats below 30, faster as it falls', () => {
    expect(healthFeel(49).breathEverySec).toBeGreaterThan(healthFeel(10).breathEverySec);
    expect(healthFeel(49).breathVolume).toBeLessThan(healthFeel(10).breathVolume);
    expect(healthFeel(30).heartbeatPerMin).toBe(0);
    expect(healthFeel(29).heartbeatPerMin).toBeGreaterThan(0);
    expect(healthFeel(10).heartbeatPerMin).toBeGreaterThan(healthFeel(29).heartbeatPerMin);
    expect(healthFeel(5).heartbeatPerMin).toBeCloseTo(healthFxDefaults.heartbeatFastPerMin);
  });

  it('makes no sound for the dead', () => {
    const feel = healthFeel(0);
    expect(feel.heartbeatPerMin).toBe(0);
    expect(feel.breathEverySec).toBe(0);
  });
});

describe('HealthFeelState', () => {
  const run = (state: HealthFeelState, seconds: number, health: number, onStep?: (s: HealthFeelState) => void) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      state.update(dt, health);
      onStep?.(state);
    }
  };

  it('eases toward the target instead of jumping, and eases away again after a heal', () => {
    const state = new HealthFeelState();
    state.update(dt, 10);
    expect(state.vignette).toBeGreaterThan(0);
    expect(state.vignette).toBeLessThan(healthFxDefaults.vignetteMaxStrength * 0.5);
    run(state, 5, 10);
    expect(state.vignette).toBeCloseTo(healthFxDefaults.vignetteMaxStrength, 1);
    run(state, 5, 100);
    expect(state.vignette).toBeCloseTo(0, 1);
    expect(state.drain).toBeCloseTo(0, 1);
  });

  it('beats at the heartbeat rate and breathes at the breath rate, with a swell on each beat', () => {
    const state = new HealthFeelState();
    let beats = 0;
    let breaths = 0;
    let swelled = false;
    run(state, 30, 5, (s) => {
      if (s.beatNow) {
        beats++;
        swelled = s.pulse === 1;
      }
      if (s.breathNow) breaths++;
    });
    expect(beats).toBeCloseTo((30 * healthFxDefaults.heartbeatFastPerMin) / 60, -1);
    expect(breaths).toBeCloseTo(30 / healthFxDefaults.breathFastEverySec, -1);
    expect(swelled).toBe(true);
  });

  it('stays quiet at 50 and above', () => {
    const state = new HealthFeelState();
    let sounds = 0;
    run(state, 20, 50, (s) => {
      if (s.beatNow || s.breathNow) sounds++;
    });
    expect(sounds).toBe(0);
  });

  it('flashes red when hit, by how hard, capped, and fades', () => {
    const state = new HealthFeelState();
    state.hit(10);
    const small = state.flash;
    state.reset();
    state.hit(30);
    expect(state.flash).toBeGreaterThan(small);
    state.hit(10000);
    expect(state.flash).toBe(healthFxDefaults.flashMax);
    run(state, healthFxDefaults.flashSec + 0.1, 100);
    expect(state.flash).toBe(0);
  });

  it('reset clears everything', () => {
    const state = new HealthFeelState();
    state.hit(50);
    run(state, 3, 5);
    state.reset();
    expect([state.vignette, state.drain, state.flash, state.pulse]).toEqual([0, 0, 0, 0]);
  });
});

describe('HealthSounds', () => {
  it('plays the heartbeat and the breath when they are due, at the loudness the feel gives', () => {
    const played: { name: SoundName; volume?: number }[] = [];
    const player: SoundPlayer = { play: (name, options) => void played.push({ name, volume: options?.volume }) };
    const sounds = new HealthSounds(player);
    const state = new HealthFeelState();
    for (let i = 0; i < 60 * 10; i++) {
      state.update(dt, 10);
      sounds.update(state);
    }
    expect(played.some((p) => p.name === 'heartbeat')).toBe(true);
    expect(played.some((p) => p.name === 'breath-heavy')).toBe(true);
    for (const p of played) expect(p.volume).toBeGreaterThan(0);
  });
});

describe('the dev slider for health', () => {
  it('sets health without a death, and holds regeneration until real damage or a heal', () => {
    const health = new PlayerHealth(new EventBus<WeaponEvents>());
    health.debugSet(20);
    for (let i = 0; i < 60 * 10; i++) health.update(dt);
    expect(health.current).toBe(20);
    health.damage(5, 'debug'); // 15, and regeneration is allowed again: 4 s wait, then 5 per second for 6 s
    for (let i = 0; i < 60 * 10; i++) health.update(dt);
    expect(health.current).toBeCloseTo(45, 0);
  });
});

describe('magazine pictures', () => {
  it('fill in five rough steps that match the words', () => {
    expect(fillShare(readMagazine(0, 30).feel)).toBe(0);
    expect(fillShare(readMagazine(5, 30).feel)).toBe(0.25);
    expect(fillShare(readMagazine(12, 30).feel)).toBe(0.5);
    expect(fillShare(readMagazine(24, 30).feel)).toBe(0.75);
    expect(fillShare(readMagazine(30, 30).feel)).toBe(1);
  });
});

describe('the health-on-screen tuning panel', () => {
  it('lists every value once, with a sensible range around its default', () => {
    const sliders = healthFxFolders.flatMap((f) => f.sliders);
    for (const s of sliders) {
      expect(s.min).toBeLessThan(s.max);
      expect(healthFxDefaults[s.key], s.key).toBeGreaterThanOrEqual(s.min);
      expect(healthFxDefaults[s.key], s.key).toBeLessThanOrEqual(s.max);
    }
    const keys = sliders.map((s) => s.key as string);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of Object.keys(healthFxDefaults)) expect(keys, `${key} is not on the panel`).toContain(key);
  });
});
