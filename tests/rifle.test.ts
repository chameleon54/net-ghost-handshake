import { describe, expect, it } from 'vitest';
import { rifleConfigDefaults } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import { Rifle, type RifleInput } from '../src/weapons/rifle';

const dtSec = 1 / 60;
const held: RifleInput = { triggerHeld: true, reloadPressed: false, canFire: true };
const idle: RifleInput = { triggerHeld: false, reloadPressed: false, canFire: true };

function setup() {
  const events = new EventBus<WeaponEvents>();
  const count = { fired: 0, empty: 0, started: 0, reloaded: 0 };
  events.on('weapon:fired', () => count.fired++);
  events.on('weapon:empty-click', () => count.empty++);
  events.on('weapon:reload-started', () => count.started++);
  events.on('weapon:reloaded', () => count.reloaded++);
  return { rifle: new Rifle(events), count };
}

function run(rifle: Rifle, input: RifleInput, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / dtSec); i++) rifle.update(dtSec, input);
}

describe('Rifle', () => {
  it('fires at the configured rate while the trigger is held', () => {
    const { rifle, count } = setup();
    run(rifle, held, 1);
    const expected = rifleConfigDefaults.fireRateRpm / 60;
    expect(Math.abs(count.fired - expected)).toBeLessThanOrEqual(1);
  });

  it('does not fire when it may not (sprinting, climbing)', () => {
    const { rifle, count } = setup();
    run(rifle, { ...held, canFire: false }, 1);
    expect(count.fired).toBe(0);
  });

  it('empties the magazine, then clicks once per trigger pull', () => {
    const { rifle, count } = setup();
    run(rifle, held, 5);
    expect(count.fired).toBe(rifleConfigDefaults.magazineRounds);
    expect(count.empty).toBe(1); // holding does not click again and again
    run(rifle, idle, 0.1);
    run(rifle, held, 0.1);
    expect(count.empty).toBe(2);
  });

  it('reloads after the reload time, not before, and cannot fire meanwhile', () => {
    const { rifle, count } = setup();
    run(rifle, held, 1);
    const firedBefore = count.fired;
    rifle.update(dtSec, { ...idle, reloadPressed: true });
    expect(rifle.reloading).toBe(true);
    run(rifle, held, rifleConfigDefaults.reloadTimeSec - 0.1);
    expect(rifle.reloading).toBe(true);
    expect(count.fired).toBe(firedBefore);
    run(rifle, idle, 0.3);
    expect(rifle.reloading).toBe(false);
    expect(count.reloaded).toBe(1);
    expect(rifle.magazines.loadedRounds).toBe(rifleConfigDefaults.magazineRounds);
  });

  it('ignores R when there is nothing better to load', () => {
    const { rifle, count } = setup();
    rifle.update(dtSec, { ...idle, reloadPressed: true });
    expect(count.started).toBe(0);
  });
});
