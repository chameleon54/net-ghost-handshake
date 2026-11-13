import { describe, expect, it } from 'vitest';
import { pistolConfigDefaults } from '../src/config/pistol';
import { rifleConfigDefaults } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun, type GunInput } from '../src/weapons/gun';

const dtSec = 1 / 60;
const held: GunInput = { triggerHeld: true, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true };
const idle: GunInput = { triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true };

function setup(kind: 'rifle' | 'pistol' = 'rifle') {
  const events = new EventBus<WeaponEvents>();
  const count = { fired: 0, empty: 0, started: 0, reloaded: 0 };
  events.on('weapon:fired', () => count.fired++);
  events.on('weapon:empty-click', () => count.empty++);
  events.on('weapon:reload-started', () => count.started++);
  events.on('weapon:reloaded', () => count.reloaded++);
  const gun =
    kind === 'rifle' ? new Gun(events, 'rifle', { ...rifleConfigDefaults }, true) : new Gun(events, 'pistol', { ...pistolConfigDefaults }, false);
  return { gun, count };
}

function run(gun: Gun, input: GunInput, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / dtSec); i++) gun.update(dtSec, input);
}

describe('rifle (automatic)', () => {
  it('fires at the configured rate while the trigger is held', () => {
    const { gun, count } = setup();
    run(gun, held, 1);
    const expected = rifleConfigDefaults.fireRateRpm / 60;
    expect(Math.abs(count.fired - expected)).toBeLessThanOrEqual(1);
  });

  it('does not fire when it may not (sprinting, climbing, drawing)', () => {
    const { gun, count } = setup();
    run(gun, { ...held, canFire: false }, 1);
    expect(count.fired).toBe(0);
  });

  it('empties the magazine, then clicks once per trigger pull', () => {
    const { gun, count } = setup();
    run(gun, held, 5);
    expect(count.fired).toBe(rifleConfigDefaults.magazineRounds + 1); // the magazine plus the chambered round
    expect(count.empty).toBe(1); // holding does not click again and again
    run(gun, idle, 0.1);
    run(gun, held, 0.1);
    expect(count.empty).toBe(2);
  });

  it('reloads after the reload time, not before, and cannot fire meanwhile', () => {
    const { gun, count } = setup();
    run(gun, held, 1);
    const firedBefore = count.fired;
    gun.update(dtSec, { ...idle, reloadPressed: true });
    expect(gun.reloading).toBe(true);
    run(gun, held, rifleConfigDefaults.reloadTimeSec - 0.1);
    expect(gun.reloading).toBe(true);
    expect(count.fired).toBe(firedBefore);
    run(gun, idle, 0.3);
    expect(gun.reloading).toBe(false);
    expect(count.reloaded).toBe(1);
    expect(gun.magazines.loadedRounds).toBe(rifleConfigDefaults.magazineRounds + 1); // a full magazine plus the chambered round
  });

  it('ignores R when there is nothing better to load', () => {
    const { gun, count } = setup();
    gun.update(dtSec, { ...idle, reloadPressed: true });
    expect(count.started).toBe(0);
  });

  it('a cancelled reload loses its progress but keeps the magazine as it was', () => {
    const { gun, count } = setup();
    run(gun, held, 0.5);
    const rounds = gun.magazines.loadedRounds;
    gun.update(dtSec, { ...idle, reloadPressed: true });
    run(gun, idle, 0.5);
    gun.interrupt();
    expect(gun.reloading).toBe(false);
    run(gun, idle, 3);
    expect(count.reloaded).toBe(0);
    expect(gun.magazines.loadedRounds).toBe(rounds);
  });
});

describe('pistol (semi-automatic)', () => {
  it('fires once per click, not while held', () => {
    const { gun, count } = setup('pistol');
    gun.update(dtSec, { ...held, triggerPressed: true });
    run(gun, held, 2);
    expect(count.fired).toBe(1);
  });

  it('cannot be clicked faster than its fire rate', () => {
    const { gun, count } = setup('pistol');
    for (let i = 0; i < 60; i++) gun.update(dtSec, { ...held, triggerPressed: true }); // a click every update for a second
    expect(count.fired).toBeLessThanOrEqual(pistolConfigDefaults.fireRateRpm / 60 + 1);
    expect(count.fired).toBeGreaterThan(5);
  });

  it('a click between two updates still fires (the button was already released)', () => {
    const { gun, count } = setup('pistol');
    gun.update(dtSec, { ...idle, triggerPressed: true });
    expect(count.fired).toBe(1);
  });

  it('has 17 rounds and one chambered, clicks when empty and reloads (with a rack) after an extra moment', () => {
    const { gun, count } = setup('pistol');
    for (let i = 0; i < 18; i++) {
      gun.update(dtSec, { ...held, triggerPressed: true });
      run(gun, idle, 0.2);
    }
    expect(count.fired).toBe(18);
    gun.update(dtSec, { ...held, triggerPressed: true });
    expect(count.empty).toBe(1);
    gun.update(dtSec, { ...idle, reloadPressed: true });
    run(gun, idle, pistolConfigDefaults.reloadTimeSec + 0.1);
    expect(count.reloaded).toBe(0); // an empty gun also racks, which takes longer
    run(gun, idle, pistolConfigDefaults.emptyReloadRackSec);
    expect(count.reloaded).toBe(1);
    expect(gun.magazines.loadedRounds).toBe(17); // the rack chambered one from the new magazine
  });
});

describe('reloads and checks', () => {
  it('an empty gun takes the rack time longer to reload than one with rounds left', () => {
    const { gun } = setup();
    run(gun, held, 5); // empty it
    expect(gun.empty).toBe(true);
    gun.update(dtSec, { ...idle, reloadPressed: true });
    expect(gun.reloadRackShare).toBeCloseTo(rifleConfigDefaults.emptyReloadRackSec / (rifleConfigDefaults.reloadTimeSec + rifleConfigDefaults.emptyReloadRackSec));

    const second = setup();
    run(second.gun, held, 0.3);
    second.gun.update(dtSec, { ...idle, reloadPressed: true });
    expect(second.gun.reloadRackShare).toBe(0);
  });

  it('holding R checks the magazine: it reports a rough word once, and blocks firing and reloading meanwhile', () => {
    const events = new EventBus<WeaponEvents>();
    const words: string[] = [];
    let fired = 0;
    events.on('weapon:magazine-checked', ({ feel }) => words.push(feel));
    events.on('weapon:fired', () => fired++);
    const gun = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true);
    gun.update(dtSec, { ...idle, checkRequested: true });
    expect(gun.checking).toBe(true);
    run(gun, held, rifleConfigDefaults.checkMagazineSec * 0.6); // trying to fire during the check
    expect(fired).toBe(0);
    expect(words).toEqual(['full']);
    run(gun, idle, rifleConfigDefaults.checkMagazineSec);
    expect(gun.checking).toBe(false);
    expect(words).toHaveLength(1);
    gun.update(dtSec, { ...held, triggerPressed: true });
    expect(fired).toBe(1); // firing works again afterwards
  });

  it('sprinting or switching away puts the magazine away', () => {
    const { gun } = setup();
    gun.update(dtSec, { ...idle, checkRequested: true });
    gun.update(dtSec, { ...idle, canFire: false });
    expect(gun.checking).toBe(false);
    gun.update(dtSec, { ...idle, checkRequested: true });
    gun.interrupt();
    expect(gun.checking).toBe(false);
  });

  it('cannot check the magazine in the middle of a reload', () => {
    const { gun } = setup();
    run(gun, held, 0.5);
    gun.update(dtSec, { ...idle, reloadPressed: true });
    gun.update(dtSec, { ...idle, checkRequested: true });
    expect(gun.checking).toBe(false);
    expect(gun.reloading).toBe(true);
  });
});
