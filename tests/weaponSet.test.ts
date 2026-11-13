import { describe, expect, it } from 'vitest';
import { knifeConfigDefaults } from '../src/config/knife';
import { pistolConfig, pistolConfigDefaults } from '../src/config/pistol';
import { rifleConfig, rifleConfigDefaults } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import type { WeaponEvents, WeaponId } from '../src/weapons/events';
import { Gun } from '../src/weapons/gun';
import { Knife } from '../src/weapons/knife';
import { WeaponSet, type WeaponSetInput } from '../src/weapons/weaponSet';

const dtSec = 1 / 60;
const none: WeaponSetInput = { select: null, wheelSteps: 0, triggerHeld: false, triggerPressed: false, reloadPressed: false, canFire: true };

function setup() {
  const events = new EventBus<WeaponEvents>();
  const count = { fired: 0, swings: 0, reloaded: 0 };
  events.on('weapon:fired', () => count.fired++);
  events.on('weapon:swing', () => count.swings++);
  events.on('weapon:reloaded', () => count.reloaded++);
  const rifle = new Gun(events, 'rifle', rifleConfig, true);
  const pistol = new Gun(events, 'pistol', pistolConfig, false);
  const weapons = new WeaponSet(events, rifle, pistol, new Knife(events));
  return { weapons, rifle, pistol, count, events };
}

function run(weapons: WeaponSet, input: Partial<WeaponSetInput>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / dtSec); i++) weapons.update(dtSec, { ...none, ...input });
}

describe('WeaponSet', () => {
  it('starts with the rifle out and ready', () => {
    const { weapons } = setup();
    expect(weapons.current).toBe('rifle');
    expect(weapons.drawing).toBe(false);
  });

  it('keys select a weapon, and nothing fires during the draw time', () => {
    const { weapons, count } = setup();
    weapons.update(dtSec, { ...none, select: 'pistol' });
    expect(weapons.current).toBe('pistol');
    expect(weapons.drawing).toBe(true);
    run(weapons, { triggerPressed: true, triggerHeld: true }, pistolConfigDefaults.drawTimeSec - 0.05);
    expect(count.fired).toBe(0);
    run(weapons, {}, 0.1);
    weapons.update(dtSec, { ...none, triggerPressed: true, triggerHeld: true });
    expect(count.fired).toBe(1);
  });

  it('each weapon has its own draw time', () => {
    const { weapons } = setup();
    const secondsDrawing = (id: WeaponId) => {
      weapons.select(id === 'rifle' ? 'pistol' : 'rifle'); // make sure the next select is a change
      run(weapons, {}, 1);
      weapons.select(id);
      let t = 0;
      while (weapons.drawing && t < 5) {
        weapons.update(dtSec, none);
        t += dtSec;
      }
      return t;
    };
    expect(secondsDrawing('rifle')).toBeCloseTo(rifleConfigDefaults.drawTimeSec, 1);
    expect(secondsDrawing('pistol')).toBeCloseTo(pistolConfigDefaults.drawTimeSec, 1);
    expect(secondsDrawing('knife')).toBeCloseTo(knifeConfigDefaults.drawTimeSec, 1);
  });

  it('the wheel cycles through the list and wraps around', () => {
    const { weapons } = setup();
    weapons.cycle(1);
    expect(weapons.current).toBe('pistol');
    weapons.cycle(1);
    expect(weapons.current).toBe('knife');
    weapons.cycle(1);
    expect(weapons.current).toBe('rifle');
    weapons.cycle(-1);
    expect(weapons.current).toBe('knife');
    weapons.cycle(-4);
    expect(weapons.current).toBe('pistol');
  });

  it('switching cancels a reload; the magazine stays as it was', () => {
    const { weapons, rifle, count } = setup();
    run(weapons, { triggerHeld: true }, 0.7);
    const rounds = rifle.magazines.loadedRounds;
    run(weapons, { reloadPressed: true }, dtSec);
    expect(rifle.reloading).toBe(true);
    weapons.select('pistol');
    expect(rifle.reloading).toBe(false);
    run(weapons, {}, 3);
    expect(count.reloaded).toBe(0);
    expect(rifle.magazines.loadedRounds).toBe(rounds);
  });

  it('each gun keeps its own magazines while holstered', () => {
    const { weapons, pistol, rifle } = setup();
    run(weapons, { triggerHeld: true }, 1);
    const rifleRounds = rifle.magazines.loadedRounds;
    weapons.select('pistol');
    run(weapons, {}, 1);
    expect(pistol.magazines.loadedRounds).toBe(pistolConfigDefaults.magazineRounds);
    weapons.select('rifle');
    expect(rifle.magazines.loadedRounds).toBe(rifleRounds);
  });

  it('the knife swings once per click, with a wait between swings, never while it may not fire', () => {
    const { weapons, count } = setup();
    weapons.select('knife');
    run(weapons, {}, knifeConfigDefaults.drawTimeSec + 0.1);
    weapons.update(dtSec, { ...none, triggerPressed: true });
    weapons.update(dtSec, { ...none, triggerPressed: true });
    expect(count.swings).toBe(1); // the second click came too soon
    run(weapons, {}, knifeConfigDefaults.swingCooldownSec + 0.1);
    weapons.update(dtSec, { ...none, triggerPressed: true, canFire: false });
    expect(count.swings).toBe(1);
    weapons.update(dtSec, { ...none, triggerPressed: true });
    expect(count.swings).toBe(2);
  });
});

// Random play: switching, firing, reloading and stabbing at random. Rounds are only ever used by shots.
describe('weapon random play', () => {
  it('never creates or loses a round, and never reloads while another weapon is out', () => {
    let seed = 4242;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const order: WeaponId[] = ['rifle', 'pistol', 'knife'];
    for (let game = 0; game < 10; game++) {
      const { weapons, rifle, pistol, events } = setup();
      const shots = { rifle: 0, pistol: 0 };
      events.on('weapon:fired', ({ weapon }) => shots[weapon]++);
      const start = { rifle: rifle.magazines.totalRounds, pistol: pistol.magazines.totalRounds };
      let held = false;
      for (let tick = 0; tick < 6000; tick++) {
        if (random() < 0.05) held = !held;
        weapons.update(dtSec, {
          select: random() < 0.01 ? order[Math.floor(random() * 3)] : null,
          wheelSteps: random() < 0.01 ? (random() < 0.5 ? -1 : 1) : 0,
          triggerHeld: held,
          triggerPressed: random() < 0.1,
          reloadPressed: random() < 0.02,
          canFire: random() < 0.9,
        });
        expect(rifle.magazines.totalRounds).toBe(start.rifle - shots.rifle);
        expect(pistol.magazines.totalRounds).toBe(start.pistol - shots.pistol);
        if (weapons.current !== 'rifle') expect(rifle.reloading).toBe(false);
        if (weapons.current !== 'pistol') expect(pistol.reloading).toBe(false);
      }
    }
  });
});
