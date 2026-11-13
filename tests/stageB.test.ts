import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { casingConfig, casingConfigDefaults } from '../src/config/casing';
import { rifleConfig } from '../src/config/rifle';
import { viewmodelConfig, viewmodelConfigDefaults } from '../src/config/viewmodel';
import { EventBus } from '../src/core/events';
import { Casings } from '../src/fx/casings';
import { buildGreybox } from '../src/level/greybox';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun } from '../src/weapons/gun';
import { HoldTap } from '../src/weapons/holdTap';
import { ViewmodelAnimator, type AnimatorInput } from '../src/weapons/viewmodel/animator';

const dtSec = 1 / 60;
const holdSec = 0.25;

describe('HoldTap', () => {
  const press = (tap: HoldTap, seconds: number, down = true) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) tap.update(dtSec, down, holdSec);
  };

  it('a quick press is a tap, reported when the key is let go', () => {
    const tap = new HoldTap();
    let taps = 0;
    let holds = 0;
    for (let i = 0; i < 6; i++) {
      tap.update(dtSec, true, holdSec);
      holds += tap.holdStarted ? 1 : 0;
      taps += tap.tapped ? 1 : 0;
    }
    expect(taps).toBe(0); // nothing yet: it could still become a hold
    tap.update(dtSec, false, holdSec);
    expect(tap.tapped).toBe(true);
    expect(holds).toBe(0);
    tap.update(dtSec, false, holdSec);
    expect(tap.tapped).toBe(false); // only once
  });

  it('a long press is a hold, reported once while down, and its release is not a tap', () => {
    const tap = new HoldTap();
    let holds = 0;
    let taps = 0;
    for (let i = 0; i < 60; i++) {
      tap.update(dtSec, true, holdSec);
      holds += tap.holdStarted ? 1 : 0;
      taps += tap.tapped ? 1 : 0;
    }
    tap.update(dtSec, false, holdSec);
    taps += tap.tapped ? 1 : 0;
    expect(holds).toBe(1);
    expect(taps).toBe(0);
  });

  it('can be used again after a hold, and a reset forgets a key that was down', () => {
    const tap = new HoldTap();
    press(tap, 0.5);
    press(tap, 0.1, false);
    press(tap, 0.1);
    tap.update(dtSec, false, holdSec);
    expect(tap.tapped).toBe(true);
    press(tap, 0.1);
    tap.reset();
    tap.update(dtSec, false, holdSec);
    expect(tap.tapped).toBe(false);
  });
});

describe('Casings', () => {
  const { collision } = buildGreybox([
    { kind: 'wall', xM: 3, zM: 0, widthM: 0.2, depthM: 10, heightM: 3 }, // x from 2.9 to 3.1
  ]);
  const setup = () => {
    const events = new EventBus<WeaponEvents>();
    const camera = new PerspectiveCamera();
    const ports = { rifle: new Vector3(), pistol: new Vector3() };
    const casings = new Casings(new Scene(), events, collision, camera, ports);
    return { casings, events };
  };
  const run = (casings: Casings, seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) {
      casings.update(dtSec);
      each?.();
    }
  };

  it('falls, bounces a little off the floor, then lies still', () => {
    const { casings } = setup();
    casings.spawn(new Vector3(0, 1, 0), new Vector3(0, 0, 0));
    const casing = casings.pool.find((c) => c.active)!;
    let landedAt = -1;
    let peakAfterFirstBounce = 0;
    run(casings, 3, () => {
      const y = casing.mesh.position.y;
      if (landedAt < 0 && y < 0.05) landedAt = 0;
      else if (landedAt === 0) peakAfterFirstBounce = Math.max(peakAfterFirstBounce, y);
    });
    expect(landedAt).toBe(0);
    expect(peakAfterFirstBounce).toBeGreaterThan(0.02); // it bounced
    expect(peakAfterFirstBounce).toBeLessThan(0.35); // but nowhere near the drop height
    expect(casing.resting).toBe(true);
    expect(casing.mesh.position.y).toBeLessThan(0.02);
  });

  it('bounces back off a wall instead of passing through', () => {
    const { casings } = setup();
    casings.spawn(new Vector3(0, 1, 0), new Vector3(8, 0, 0));
    const casing = casings.pool.find((c) => c.active)!;
    let furthest = 0;
    run(casings, 1.5, () => (furthest = Math.max(furthest, casing.mesh.position.x)));
    expect(furthest).toBeLessThan(2.95); // stopped by the wall face at 2.9
    expect(furthest).toBeGreaterThan(2.5);
  });

  it('disappears after its lifetime, and a full pool reuses the oldest casing', () => {
    const { casings } = setup();
    for (let i = 0; i < 30; i++) casings.spawn(new Vector3(0, 1, 0), new Vector3(1, 1, 0));
    expect(casings.pool.filter((c) => c.active).length).toBeLessThanOrEqual(casings.pool.length);
    run(casings, casingConfig.lifetimeSec + 1);
    expect(casings.pool.every((c) => !c.active && !c.mesh.visible)).toBe(true);
  });

  it('every shot throws one out', () => {
    const { casings, events } = setup();
    events.emit('weapon:fired', { weapon: 'rifle', heat: 0 });
    events.emit('weapon:fired', { weapon: 'pistol', heat: 0 });
    expect(casings.pool.filter((c) => c.active)).toHaveLength(2);
  });

  it('keeps its numbers on the panel', () => {
    expect(Object.keys(casingConfigDefaults).length).toBeGreaterThan(5);
  });
});

describe('ViewmodelAnimator, stage B', () => {
  const idle: AnimatorInput = { weapon: 'rifle', drawProgress: 1, reloadProgress: null, sprinting: false };
  const run = (animator: ViewmodelAnimator, input: AnimatorInput, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) animator.update(dtSec, input);
  };

  it('an empty gun keeps its bolt locked back; a loaded one lets it go forward', () => {
    const animator = new ViewmodelAnimator();
    animator.fired('rifle');
    run(animator, { ...idle, lockedOpen: true }, 1);
    expect(animator.pose.slideZ).toBeCloseTo(viewmodelConfigDefaults.rifleBoltBackM);
    run(animator, { ...idle, lockedOpen: false }, 0.3);
    expect(animator.pose.slideZ).toBeCloseTo(0);
  });

  it('an empty reload starts with the slide open and ends with it released, hand home, no jump', () => {
    const animator = new ViewmodelAnimator();
    const input = (p: number): AnimatorInput => ({ ...idle, weapon: 'pistol', lockedOpen: true, reloadProgress: p, reloadRackShare: 0.2 });
    animator.update(dtSec, input(0));
    expect(animator.pose.slideZ).toBeCloseTo(viewmodelConfigDefaults.pistolSlideBackM);
    animator.update(dtSec, input(0.5)); // mid magazine swap: slide still open
    expect(animator.pose.slideZ).toBeCloseTo(viewmodelConfigDefaults.pistolSlideBackM);
    animator.update(dtSec, input(0.99)); // the rack has finished: slide forward
    expect(animator.pose.slideZ).toBeLessThan(viewmodelConfigDefaults.pistolSlideBackM * 0.1);
    animator.update(dtSec, { ...idle, weapon: 'pistol' }); // the reload is over
    expect(animator.pose.slideZ).toBeCloseTo(0);
    expect(animator.pose.handZ).toBe(0);
  });

  it('the slide moves smoothly through the rack (no jump between frames)', () => {
    const animator = new ViewmodelAnimator();
    let previous = -1;
    for (let i = 0; i <= 300; i++) {
      animator.update(dtSec, { ...idle, lockedOpen: true, reloadProgress: i / 300, reloadRackShare: 0.25 });
      if (previous >= 0) expect(Math.abs(animator.pose.slideZ - previous)).toBeLessThan(0.01);
      previous = animator.pose.slideZ;
    }
  });

  it('checking the magazine lifts it up and toward the camera, tipped to face it, and puts it back', () => {
    const animator = new ViewmodelAnimator();
    animator.update(dtSec, { ...idle, checkProgress: 0.6 });
    expect(animator.pose.magY).toBeCloseTo(viewmodelConfigDefaults.checkLiftUpM, 2);
    expect(animator.pose.magX).toBeCloseTo(-viewmodelConfigDefaults.checkLiftSideM, 2);
    expect(animator.pose.magZ).toBeCloseTo(viewmodelConfigDefaults.checkLiftTowardM, 2);
    expect(animator.pose.magPitchRad).toBeCloseTo(viewmodelConfigDefaults.checkMagTiltRad, 2);
    expect(animator.pose.magVisible).toBe(true);
    expect(animator.pose.handZ).toBeGreaterThan(0.05);
    animator.update(dtSec, { ...idle, checkProgress: null });
    expect([animator.pose.magX, animator.pose.magY, animator.pose.magZ, animator.pose.magPitchRad, animator.pose.magRollRad]).toEqual([0, 0, 0, 0, 0]);
  });

  it('an inspect plays once and ends at rest; the chamber check moves the bolt', () => {
    const animator = new ViewmodelAnimator();
    animator.update(dtSec, idle);
    animator.inspect();
    let sawBolt = false;
    let rolled = 0;
    for (let i = 0; i < Math.round((viewmodelConfigDefaults.inspectGunSec + 0.2) / dtSec); i++) {
      animator.update(dtSec, idle);
      if (animator.pose.slideZ > viewmodelConfigDefaults.rifleBoltBackM * 0.5) sawBolt = true;
      rolled = Math.max(rolled, Math.abs(animator.pose.rollRad));
    }
    expect(sawBolt).toBe(true);
    expect(rolled).toBeGreaterThan(0.5);
    for (const v of [animator.pose.x, animator.pose.y, animator.pose.z, animator.pose.pitchRad, animator.pose.yawRad, animator.pose.rollRad, animator.pose.slideZ]) {
      expect(Math.abs(v)).toBeLessThan(1e-6);
    }
  });

  it('an inspect gives way to firing, sprinting, reloading and aiming', () => {
    const roll = (action: (animator: ViewmodelAnimator) => AnimatorInput) => {
      const animator = new ViewmodelAnimator();
      animator.update(dtSec, idle);
      animator.inspect();
      run(animator, idle, 0.5);
      const input = action(animator);
      animator.update(dtSec, input);
      run(animator, { ...input, sprinting: false, reloadProgress: null, aimBlend: 0 }, 0.5); // the cause is over; the inspect must not resume
      return Math.abs(animator.pose.rollRad);
    };
    expect(roll((a) => (a.fired('rifle'), idle))).toBeLessThan(0.2);
    expect(roll(() => ({ ...idle, sprinting: true }))).toBeLessThan(0.2);
    expect(roll(() => ({ ...idle, reloadProgress: 0.1 }))).toBeLessThan(0.2);
    expect(roll(() => ({ ...idle, aimBlend: 0.5 }))).toBeLessThan(0.2);
  });

  it('the knife is flipped in an inspect and ends at rest', () => {
    const animator = new ViewmodelAnimator();
    const knife: AnimatorInput = { ...idle, weapon: 'knife' };
    animator.update(dtSec, knife);
    animator.inspect();
    let turned = 0;
    for (let i = 0; i < Math.round((viewmodelConfigDefaults.inspectKnifeSec + 0.2) / dtSec); i++) {
      animator.update(dtSec, knife);
      turned = Math.max(turned, animator.pose.pitchRad);
    }
    expect(turned).toBeGreaterThan(Math.PI);
    expect(Math.abs(animator.pose.pitchRad % (2 * Math.PI))).toBeLessThan(1e-6);
  });

  it('walking bobs the weapon; standing still, crouching and aiming bob less or not at all', () => {
    const bobRange = (input: Partial<AnimatorInput>) => {
      const animator = new ViewmodelAnimator();
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < 240; i++) {
        animator.update(dtSec, { ...idle, ...input });
        if (i > 60) {
          low = Math.min(low, animator.pose.x);
          high = Math.max(high, animator.pose.x);
        }
      }
      return high - low;
    };
    const walking = bobRange({ speedMps: 4 });
    expect(walking).toBeGreaterThan(viewmodelConfigDefaults.bobSideM);
    expect(bobRange({ speedMps: 0 })).toBeLessThan(1e-6);
    expect(bobRange({ speedMps: 4, crouching: true })).toBeLessThan(walking * 0.7);
    expect(bobRange({ speedMps: 4, aimBlend: 1 })).toBeLessThan(walking * 0.4);
  });

  it('turning swings the weapon the other way, then it settles, and it is limited', () => {
    const animator = new ViewmodelAnimator();
    animator.update(dtSec, { ...idle, lookYawRad: 0.05 }); // a fast turn to the left
    run(animator, { ...idle, lookYawRad: 0.05 }, 0.2);
    expect(animator.pose.yawRad).toBeLessThan(-0.005); // the weapon lags to the right
    run(animator, idle, 2);
    expect(Math.abs(animator.pose.yawRad)).toBeLessThan(0.001);
    for (let i = 0; i < 60; i++) animator.update(dtSec, { ...idle, lookYawRad: 0.5 });
    expect(Math.abs(animator.pose.yawRad)).toBeLessThanOrEqual(viewmodelConfigDefaults.swayMaxRad + 1e-9);
  });

  it('slow motion stays off in these tests', () => {
    expect(viewmodelConfig.slowMotionScale).toBe(viewmodelConfigDefaults.slowMotionScale);
  });
});

// Random play: the real gun and the animator side by side. Whatever the player does, the animator is only ever asked for a
// reload, a rack or a check while the gun is really doing it, and the animator never produces a broken pose.
describe('gun and animator random play', () => {
  it('stay in step, and every pose value stays finite and bounded', () => {
    let seed = 777;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let badPoses = 0;
    let overlaps = 0;
    for (let game = 0; game < 10; game++) {
      const events = new EventBus<WeaponEvents>();
      const gun = new Gun(events, 'rifle', rifleConfig, true, random);
      const animator = new ViewmodelAnimator();
      events.on('weapon:fired', ({ weapon }) => animator.fired(weapon));
      let held = false;
      for (let tick = 0; tick < 4000; tick++) {
        if (random() < 0.04) held = !held;
        gun.update(dtSec, {
          triggerHeld: held,
          triggerPressed: false,
          reloadPressed: random() < 0.01,
          checkRequested: random() < 0.01,
          canFire: random() < 0.95,
        });
        if (random() < 0.002) gun.interrupt();
        if (random() < 0.002) animator.inspect();
        animator.update(dtSec, {
          weapon: 'rifle',
          drawProgress: 1,
          reloadProgress: gun.reloading ? gun.reloadProgress : null,
          reloadRackShare: gun.reloadRackShare,
          checkProgress: gun.checking ? gun.checkProgress : null,
          lockedOpen: gun.empty,
          sprinting: random() < 0.1,
          aimBlend: random(),
          speedMps: random() * 6,
          lookYawRad: (random() - 0.5) * 0.1,
          lookPitchRad: (random() - 0.5) * 0.1,
        });
        const p = animator.pose;
        for (const v of [p.x, p.y, p.z, p.pitchRad, p.yawRad, p.rollRad, p.magY, p.slideZ, p.handX, p.handY, p.handZ]) {
          if (!Number.isFinite(v) || Math.abs(v) >= 15) badPoses++; // an inspect flip of the knife is the largest: 4 pi
        }
        // The gun is never reloading and checking at once.
        if (gun.reloading && gun.checking) overlaps++;
      }
    }
    expect(badPoses).toBe(0);
    expect(overlaps).toBe(0);
  });
});
