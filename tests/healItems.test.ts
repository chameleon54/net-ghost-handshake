import { afterEach, describe, expect, it } from 'vitest';
import { WeaponSounds } from '../src/audio/weaponSounds';
import type { SoundName } from '../src/audio/recipes';
import type { SoundPlayer } from '../src/audio/soundPlayer';
import { difficultySetting } from '../src/config/difficulty';
import { healthConfig } from '../src/config/health';
import { EventBus } from '../src/core/events';
import { Health } from '../src/enemies/health';
import { HealItems } from '../src/player/healItems';
import { PlayerHealth } from '../src/player/playerHealth';
import type { WeaponEvents } from '../src/weapons/events';

const dt = 1 / 60;
const idle = { pressed: false, canUse: true };
const press = { pressed: true, canUse: true };

function setup() {
  const events = new EventBus<WeaponEvents>();
  const health = new PlayerHealth(events);
  const heals = new HealItems(events, health);
  const log: string[] = [];
  events.on('heal:started', () => log.push('started'));
  events.on('player:healed', ({ amount }) => log.push(`healed ${amount}`));
  /** Runs the health and the heals for `seconds`, pressing H in the first update if `pressFirst`. */
  const run = (seconds: number, pressFirst = false) => {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      health.update(dt);
      heals.update(dt, i === 0 && pressFirst ? press : idle);
    }
  };
  return { events, health, heals, log, run };
}

afterEach(() => {
  difficultySetting.current = 'normal';
});

describe('Health.heal', () => {
  it('adds up to the ceiling and never lowers what is above it', () => {
    const h = new Health(100);
    h.damage(80); // 20
    h.heal(100, 50);
    expect(h.current).toBe(50);
    h.heal(10, 50);
    expect(h.current).toBe(50);
    h.heal(30); // no ceiling: up to max
    expect(h.current).toBe(80);
    h.heal(500);
    expect(h.current).toBe(100);
  });

  it('does nothing once dead', () => {
    const h = new Health(100);
    h.kill();
    h.heal(50);
    expect(h.current).toBe(0);
  });
});

describe('regeneration', () => {
  it('waits 4 s after the last damage, then climbs to 50 and stops', () => {
    const { health, run } = setup();
    health.damage(75, 'debug'); // 25
    run(3.9);
    expect(health.current).toBe(25);
    run(0.3); // 4.2 s: it has started
    expect(health.current).toBeGreaterThan(25);
    run(20);
    expect(health.current).toBeCloseTo(50, 5);
    expect(health.regenerating).toBe(false);
  });

  it('never lifts health that is already at or above 50, and never lowers it', () => {
    const { health, run } = setup();
    health.damage(30, 'debug'); // 70
    run(10);
    expect(health.current).toBe(70);
  });

  it('any new damage restarts the wait', () => {
    const { health, run } = setup();
    health.damage(75, 'debug');
    run(3.5);
    health.damage(5, 'debug');
    run(3.5);
    expect(health.current).toBe(20); // 7 s in total, but only 3.5 s since the last hit
    run(1);
    expect(health.current).toBeGreaterThan(20);
  });

  it('does not bring the dead back', () => {
    const { health, run } = setup();
    health.damage(500, 'debug');
    run(10);
    expect(health.dead).toBe(true);
    expect(health.current).toBe(0);
  });

  it('is faster on Easy than on Normal, and the same on Normal and Hard', () => {
    const gained = (level: 'easy' | 'normal' | 'hard') => {
      difficultySetting.current = level;
      const { health, run } = setup();
      health.damage(90, 'debug'); // 10
      run(healthConfig.regenDelaySec + 1);
      return health.current - 10;
    };
    expect(gained('easy')).toBeCloseTo(healthConfig.regenPerSecEasy, 0);
    expect(gained('normal')).toBeCloseTo(healthConfig.regenPerSecNormal, 0);
    expect(gained('hard')).toBeCloseTo(gained('normal'), 5);
    expect(gained('easy')).toBeGreaterThan(gained('normal'));
  });
});

describe('heal items', () => {
  it('starts with 3, and a use takes 1 s and then adds 50, above the regeneration ceiling', () => {
    const { health, heals, log, run } = setup();
    expect(heals.count).toBe(3);
    health.damage(50, 'debug'); // 50
    run(0.5, true);
    expect(heals.busy).toBe(true);
    expect(heals.count).toBe(2);
    expect(health.current).toBe(50);
    run(0.6);
    expect(heals.busy).toBe(false);
    expect(health.current).toBe(100);
    expect(log).toEqual(['started', 'healed 50']);
  });

  it('is capped at full health, and reports what was really added', () => {
    const { health, run, log } = setup();
    health.damage(20, 'debug'); // 80
    run(1.2, true);
    expect(health.current).toBe(100);
    expect(log).toEqual(['started', 'healed 20']);
  });

  it('does nothing at full health, so none is wasted, or with none left', () => {
    const { health, heals, run, log } = setup();
    run(0.2, true);
    expect(heals.count).toBe(3);
    expect(log).toEqual([]);
    health.damage(50, 'debug');
    for (let i = 0; i < 3; i++) {
      run(1.1, true);
      health.damage(50, 'debug');
    }
    expect(heals.count).toBe(0);
    const before = log.length;
    run(1.1, true);
    expect(log.length).toBe(before);
  });

  it('waits while the hands are busy, and the press is not remembered', () => {
    const { health, heals, run } = setup();
    health.damage(50, 'debug');
    heals.update(dt, { pressed: true, canUse: false });
    run(0.1);
    expect(heals.busy).toBe(false);
    expect(heals.count).toBe(3);
  });

  it('damage during a use does not cancel it, but death does', () => {
    const a = setup();
    a.health.damage(50, 'debug');
    a.run(0.3, true);
    a.health.damage(20, 'debug'); // 30
    a.run(1);
    expect(a.health.current).toBe(80);

    const b = setup();
    b.health.damage(50, 'debug');
    b.run(0.3, true);
    b.health.damage(500, 'debug');
    b.run(2);
    expect(b.health.dead).toBe(true);
    expect(b.heals.busy).toBe(false);
  });

  it('give stops at the carry limit, and reset brings back the starting heals', () => {
    const { heals } = setup();
    expect(heals.give(5)).toBe(0);
    heals.reset();
    expect(heals.count).toBe(healthConfig.startingHeals);
  });
});

describe('heal sounds', () => {
  it('plays a sound when the use starts and another when it lands', () => {
    const events = new EventBus<WeaponEvents>();
    const names: SoundName[] = [];
    const player: SoundPlayer = { play: (name) => void names.push(name) };
    new WeaponSounds(events, player, () => 0.5);
    const health = new PlayerHealth(events);
    const heals = new HealItems(events, health);
    health.damage(50, 'debug');
    heals.update(dt, press);
    for (let i = 0; i < 70; i++) heals.update(dt, idle);
    expect(names).toEqual(['heal-use', 'heal-done']);
  });
});
