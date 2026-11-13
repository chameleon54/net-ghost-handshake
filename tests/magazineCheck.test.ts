import { describe, expect, it } from 'vitest';
import { WeaponSounds } from '../src/audio/weaponSounds';
import type { SoundName } from '../src/audio/recipes';
import type { SoundPlayer } from '../src/audio/soundPlayer';
import { rifleConfigDefaults } from '../src/config/rifle';
import { viewmodelConfigDefaults as c } from '../src/config/viewmodel';
import { EventBus } from '../src/core/events';
import { checkHoldProgress } from '../src/weapons/checkTiming';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun, type GunInput } from '../src/weapons/gun';
import { checkPose, type CheckPose, type CheckShape } from '../src/weapons/viewmodel/timeline';

const dt = 1 / 60;
const shape: CheckShape = {
  handReachM: 0.26,
  magPullM: c.checkMagPullM,
  liftUpM: c.checkLiftUpM,
  liftSideM: c.checkLiftSideM,
  liftTowardM: c.checkLiftTowardM,
  magTiltRad: c.checkMagTiltRad,
  magRollRad: c.checkMagRollRad,
};
const at = (progress: number): CheckPose => {
  const out: CheckPose = { handX: 0, handY: 0, handZ: 0, magY: 0, magVisible: true, tilt: 0, magX: 0, magZ: 0, magPitchRad: 0, magRollRad: 0 };
  checkPose(progress, shape, out);
  return out;
};

describe('checkPose', () => {
  it('starts and ends at rest, with the magazine seated and the hand home', () => {
    for (const p of [at(0), at(1)]) {
      for (const value of [p.magX, p.magY, p.magZ, p.magPitchRad, p.magRollRad, p.handX, p.handY, p.handZ, p.tilt]) expect(Math.abs(value)).toBeLessThan(1e-9);
    }
  });

  it('is fully lifted at the hold point: up, to the left, toward the camera, tipped to face it', () => {
    const out = at(checkHoldProgress);
    expect(out.magY).toBeCloseTo(c.checkLiftUpM, 6);
    expect(out.magX).toBeCloseTo(-c.checkLiftSideM, 6);
    expect(out.magZ).toBeCloseTo(c.checkLiftTowardM, 6);
    expect(out.magPitchRad).toBeCloseTo(c.checkMagTiltRad, 6);
  });

  it('slides out of the well first, going down, before it is lifted', () => {
    expect(at(0.2).magY).toBeLessThan(0);
    expect(at(0.2).magPitchRad).toBeLessThan(0.2);
  });

  it('is lifted higher at every step on the way up, and lowered at every step on the way back', () => {
    for (let i = 0.35 * 200; i < checkHoldProgress * 200; i++) expect(at((i + 1) / 200).magY).toBeGreaterThanOrEqual(at(i / 200).magY);
    for (let i = checkHoldProgress * 200; i < 0.8 * 200; i++) expect(at((i + 1) / 200).magY).toBeLessThanOrEqual(at(i / 200).magY);
  });

  it('stands still at the hold point, so freezing the check there is invisible, and moves smoothly from it', () => {
    const before = at(checkHoldProgress - 0.002);
    const held = at(checkHoldProgress);
    const after = at(checkHoldProgress + 0.002);
    expect(Math.abs(held.magY - before.magY)).toBeLessThan(0.0005);
    expect(Math.abs(after.magY - held.magY)).toBeLessThan(0.0005);
  });

  it('never stops between the stages: it moves the whole way from the start to the hold point and back to the end', () => {
    // From the first moment the magazine moves until it is held, and from the hold until it is seated, its total speed is never near zero.
    const speed = (p: number): number => {
      const a = at(p - 0.005);
      const b = at(p + 0.005);
      return Math.hypot(b.magX - a.magX, b.magY - a.magY, b.magZ - a.magZ);
    };
    for (const p of [0.3, 0.35, 0.4, 0.45, 0.5]) expect(speed(p), `speed at ${p}`).toBeGreaterThan(0.0005);
    for (const p of [0.7, 0.75, 0.8, 0.85]) expect(speed(p), `speed at ${p}`).toBeGreaterThan(0.0005);
  });

  it('the hand carries the magazine: it is wherever the magazine is', () => {
    const held = at(checkHoldProgress);
    expect(held.handX).toBeCloseTo(held.magX, 6);
    expect(held.handZ).toBeCloseTo(shape.handReachM + held.magZ, 6);
    expect(held.handY).toBeGreaterThan(0);
  });

  it('moves smoothly: no jump between frames', () => {
    let previous = at(0);
    for (let i = 1; i <= 300; i++) {
      const now = at(i / 300);
      expect(Math.abs(now.magY - previous.magY), `y at ${i}`).toBeLessThan(0.02);
      expect(Math.abs(now.magX - previous.magX)).toBeLessThan(0.02);
      expect(Math.abs(now.magZ - previous.magZ)).toBeLessThan(0.02);
      expect(Math.abs(now.magPitchRad - previous.magPitchRad)).toBeLessThan(0.06);
      expect(Math.abs(now.handY - previous.handY)).toBeLessThan(0.03);
      previous = now;
    }
  });
});

describe('holding R on the lifted magazine', () => {
  const total = rifleConfigDefaults.checkMagazineSec;
  const start: GunInput = { triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: true, canFire: true };
  const idle: GunInput = { ...start, checkRequested: false };

  function setup() {
    const events = new EventBus<WeaponEvents>();
    const log: string[] = [];
    events.on('weapon:magazine-checked', () => log.push('checked'));
    events.on('weapon:check-returning', ({ remainingSec }) => log.push(`returning ${remainingSec.toFixed(2)}`));
    events.on('weapon:interrupted', () => log.push('interrupted'));
    const gun = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true, () => 0.999);
    gun.update(dt, start);
    const run = (input: GunInput, seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) gun.update(dt, input);
    };
    return { gun, log, run, events };
  }

  it('stays on the lifted magazine for as long as R is held, reading it once', () => {
    const { gun, log, run } = setup();
    run({ ...idle, reloadHeld: true }, total * 3);
    expect(gun.checking).toBe(true);
    expect(gun.checkProgress).toBeCloseTo(checkHoldProgress, 4);
    expect(log).toEqual(['checked']);
  });

  it('puts the magazine back when R is let go, in the rest of the check time, and ends the check', () => {
    const { gun, log, run } = setup();
    run({ ...idle, reloadHeld: true }, total * 2);
    run({ ...idle, reloadHeld: false }, 0.05);
    expect(log[0]).toBe('checked');
    expect(log[1]).toMatch(/^returning /);
    expect(Number(log[1].split(' ')[1])).toBeCloseTo(total * (1 - checkHoldProgress), 1); // the rest of the check time
    run({ ...idle, reloadHeld: false }, total);
    expect(gun.checking).toBe(false);
  });

  it('carries on by itself if R is let go early, reading the magazine at the top and putting it back', () => {
    const { gun, log, run } = setup();
    run({ ...idle, reloadHeld: false }, total + 0.1);
    expect(gun.checking).toBe(false);
    expect(log.filter((l) => l === 'checked')).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('returning'))).toHaveLength(1);
  });

  it('is put away at once by sprinting, even while R is held', () => {
    const { gun, log, run } = setup();
    run({ ...idle, reloadHeld: true }, total * 2);
    gun.update(dt, { ...idle, reloadHeld: true, canFire: false });
    expect(gun.checking).toBe(false);
    expect(log).toContain('interrupted');
  });

  it('times the magazine-in sound from the put-back, so it matches however long R was held', () => {
    const { events, gun, run } = setup();
    const names: SoundName[] = [];
    const player: SoundPlayer = { play: (name) => void names.push(name) };
    const sounds = new WeaponSounds(events, player, () => 0.5);
    // The check had already started in setup(); start a fresh one with the sounds listening.
    run({ ...idle, reloadHeld: false }, total + 0.1);
    names.length = 0;
    gun.update(dt, start);
    events.emit('weapon:check-started', { weapon: 'rifle', durationSec: total });
    const wait = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        gun.update(dt, { ...idle, reloadHeld: true });
        sounds.update(dt);
      }
    };
    wait(total * 2); // held up for a long time: only the magazine-out sound so far
    expect(names).toEqual(['check-out']);
    for (let i = 0; i < Math.round(total / dt); i++) {
      gun.update(dt, { ...idle, reloadHeld: false });
      sounds.update(dt);
    }
    expect(names).toEqual(['check-out', 'check-in']);
  });
});
