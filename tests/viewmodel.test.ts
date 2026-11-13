import { describe, expect, it } from 'vitest';
import { pistolConfig } from '../src/config/pistol';
import { rifleConfig } from '../src/config/rifle';
import { viewmodelConfig, viewmodelConfigDefaults } from '../src/config/viewmodel';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun } from '../src/weapons/gun';
import { Knife } from '../src/weapons/knife';
import { ViewmodelAnimator, type AnimatorInput } from '../src/weapons/viewmodel/animator';
import { Spring } from '../src/weapons/viewmodel/spring';
import { easeOutBack, reloadPose, segment, smooth, type ReloadPose } from '../src/weapons/viewmodel/timeline';
import { WeaponSet } from '../src/weapons/weaponSet';

const dtSec = 1 / 60;

describe('Spring', () => {
  it('settles back to its target after a kick', () => {
    const spring = new Spring(14, 0.45);
    spring.impulse(1);
    for (let i = 0; i < 120; i++) spring.update(dtSec);
    expect(Math.abs(spring.value)).toBeLessThan(0.001);
    expect(Math.abs(spring.velocity)).toBeLessThan(0.01);
  });

  it('overshoots only a little with the starting values, and not at all when fully damped', () => {
    const lightlyDamped = new Spring(14, 0.45);
    lightlyDamped.impulse(1);
    let highest = 0;
    let lowest = 0;
    for (let i = 0; i < 600; i++) {
      lightlyDamped.update(1 / 600);
      highest = Math.max(highest, lightlyDamped.value);
      lowest = Math.min(lowest, lightlyDamped.value);
    }
    expect(highest).toBeCloseTo(1, 1); // the push reaches the asked-for peak
    expect(lowest).toBeLessThan(0); // it does swing back past home
    expect(lowest).toBeGreaterThan(-0.3); // but not by much

    const critical = new Spring(14, 1);
    critical.impulse(1);
    for (let i = 0; i < 120; i++) {
      critical.update(dtSec);
      expect(critical.value).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('stays stable after a very long frame', () => {
    const spring = new Spring(40, 0.3);
    spring.impulse(1);
    spring.update(0.5);
    expect(Math.abs(spring.value)).toBeLessThan(1.5);
    expect(Number.isFinite(spring.value)).toBe(true);
  });
});

describe('timeline curves', () => {
  it('segment and smooth stay between 0 and 1 and hit the ends', () => {
    expect(segment(0.5, 0.2, 0.4)).toBe(1);
    expect(segment(0.1, 0.2, 0.4)).toBe(0);
    expect(smooth(0)).toBe(0);
    expect(smooth(1)).toBe(1);
  });

  it('easeOutBack starts at 0, ends at 1 and goes past 1 on the way', () => {
    expect(easeOutBack(0, 1.6)).toBeCloseTo(0);
    expect(easeOutBack(1, 1.6)).toBeCloseTo(1);
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => easeOutBack(i / 99, 1.6)));
    expect(peak).toBeGreaterThan(1.05);
  });
});

describe('reloadPose', () => {
  const shape = { handReachM: 0.26, magDropM: 0.28, handDipM: 0.32 };
  const at = (progress: number): ReloadPose => {
    const out: ReloadPose = { handX: 0, handY: 0, handZ: 0, magY: 0, magVisible: true, tilt: 0 };
    reloadPose(progress, shape, out);
    return out;
  };

  it('starts and ends at rest, so the weapon does not jump when a reload begins or ends', () => {
    for (const p of [0, 1]) {
      const pose = at(p);
      expect(pose.handX).toBeCloseTo(0);
      expect(pose.handY).toBeCloseTo(0);
      expect(pose.handZ).toBeCloseTo(0);
      expect(pose.magY).toBeCloseTo(0);
      expect(pose.magVisible).toBe(true);
      expect(pose.tilt).toBeCloseTo(0);
    }
  });

  it('the old magazine falls, the hand dips out of frame, then comes back with a new magazine', () => {
    expect(at(0.1).handZ).toBeGreaterThan(0.1); // reaching back to the magazine
    expect(at(0.28).magY).toBeLessThan(-0.15); // falling
    expect(at(0.4).magVisible).toBe(false); // gone while the hand fetches a new one
    expect(at(0.45).handY).toBeLessThan(-0.2); // dipped down
    expect(at(0.7).magVisible).toBe(true); // brought back
    expect(at(0.7).magY).toBeGreaterThan(at(0.56).magY); // rising into the well
    expect(at(0.8).magY).toBeCloseTo(0, 2); // seated by about here
  });

  it('is smooth: nothing jumps between two neighbouring frames', () => {
    let previous = at(0);
    for (let i = 1; i <= 600; i++) {
      const pose = at(i / 600);
      expect(Math.abs(pose.handY - previous.handY)).toBeLessThan(0.02);
      expect(Math.abs(pose.handZ - previous.handZ)).toBeLessThan(0.02);
      if (pose.magVisible && previous.magVisible) expect(Math.abs(pose.magY - previous.magY)).toBeLessThan(0.02);
      previous = pose;
    }
  });
});

describe('ViewmodelAnimator', () => {
  const idle: AnimatorInput = { weapon: 'rifle', drawProgress: 1, reloadProgress: null, sprinting: false };
  const run = (animator: ViewmodelAnimator, input: AnimatorInput, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) animator.update(dtSec, input);
  };

  it('rests at zero when nothing is happening', () => {
    const animator = new ViewmodelAnimator();
    run(animator, idle, 0.5);
    const p = animator.pose;
    for (const value of [p.x, p.y, p.z, p.pitchRad, p.yawRad, p.rollRad, p.slideZ, p.magY, p.handY]) expect(Math.abs(value)).toBeLessThan(1e-9);
  });

  it('kicks back and flips the muzzle up on a shot, then settles', () => {
    const animator = new ViewmodelAnimator();
    animator.fired('rifle');
    animator.update(dtSec, idle);
    expect(animator.pose.z).toBeGreaterThan(0.01);
    expect(animator.pose.pitchRad).toBeGreaterThan(0.02);
    run(animator, idle, 1.5);
    expect(Math.abs(animator.pose.z)).toBeLessThan(0.001);
    expect(Math.abs(animator.pose.pitchRad)).toBeLessThan(0.001);
  });

  it('the bolt goes back and returns after each shot', () => {
    const animator = new ViewmodelAnimator();
    animator.fired('rifle');
    let furthest = 0;
    for (let i = 0; i < 30; i++) {
      animator.update(dtSec, idle);
      furthest = Math.max(furthest, animator.pose.slideZ);
    }
    expect(furthest).toBeGreaterThan(viewmodelConfigDefaults.rifleBoltBackM * 0.5);
    expect(animator.pose.slideZ).toBeCloseTo(0);
  });

  it('the pistol kicks harder than the rifle', () => {
    const rifle = new ViewmodelAnimator();
    const pistol = new ViewmodelAnimator();
    const pistolIdle: AnimatorInput = { ...idle, weapon: 'pistol' };
    pistol.update(dtSec, pistolIdle); // taking the pistol out first, which clears any older motion
    rifle.fired('rifle');
    pistol.fired('pistol');
    rifle.update(dtSec, idle);
    pistol.update(dtSec, pistolIdle);
    expect(pistol.pose.pitchRad).toBeGreaterThan(rifle.pose.pitchRad);
  });

  it('the draw starts lowered and tilted and ends at rest', () => {
    const animator = new ViewmodelAnimator();
    animator.update(dtSec, { ...idle, drawProgress: 0 });
    expect(animator.pose.y).toBeCloseTo(-viewmodelConfigDefaults.drawLowerM);
    expect(animator.pose.pitchRad).toBeGreaterThan(0.3);
    animator.update(dtSec, { ...idle, drawProgress: 1 });
    expect(animator.pose.y).toBeCloseTo(0);
    expect(animator.pose.pitchRad).toBeCloseTo(0);
  });

  it('follows the reload progress it is given, and hides the magazine mid-reload', () => {
    const animator = new ViewmodelAnimator();
    animator.update(dtSec, { ...idle, reloadProgress: 0.4 });
    expect(animator.pose.magVisible).toBe(false);
    expect(animator.pose.handY).toBeLessThan(-0.1);
    animator.update(dtSec, { ...idle, reloadProgress: null });
    expect(animator.pose.magVisible).toBe(true);
    expect(animator.pose.handY).toBe(0);
  });

  it('eases into the sprint pose and back out', () => {
    const animator = new ViewmodelAnimator();
    run(animator, { ...idle, sprinting: true }, 0.5);
    expect(animator.pose.yawRad).toBeCloseTo(viewmodelConfigDefaults.sprintYawRad);
    expect(animator.pose.y).toBeCloseTo(viewmodelConfigDefaults.sprintOffsetYM);
    run(animator, idle, 0.5);
    expect(animator.pose.yawRad).toBeCloseTo(0);
  });

  it('the knife slashes across and returns to rest', () => {
    const animator = new ViewmodelAnimator();
    const knife: AnimatorInput = { ...idle, weapon: 'knife' };
    animator.update(dtSec, knife);
    animator.swung();
    let sweptLeft = 0;
    let sweptRight = 0;
    for (let i = 0; i < 30; i++) {
      animator.update(dtSec, knife);
      sweptLeft = Math.min(sweptLeft, animator.pose.yawRad);
      sweptRight = Math.max(sweptRight, animator.pose.yawRad);
    }
    expect(sweptRight).toBeGreaterThan(0.2); // winds back to one side
    expect(sweptLeft).toBeLessThan(-0.5); // slashes across to the other
    expect(animator.pose.yawRad).toBeCloseTo(0);
    expect(animator.pose.z).toBeCloseTo(0);
  });

  it('a preview plays a reload on its own and then stops', () => {
    const animator = new ViewmodelAnimator();
    animator.update(dtSec, idle);
    animator.playPreview('reload', 1);
    let sawMagGone = false;
    for (let i = 0; i < 90; i++) {
      animator.update(dtSec, idle);
      if (!animator.pose.magVisible) sawMagGone = true;
    }
    expect(sawMagGone).toBe(true);
    expect(animator.pose.magVisible).toBe(true);
    expect(animator.pose.handY).toBe(0);
  });

  it('slow motion stretches a preview', () => {
    viewmodelConfig.slowMotionScale = 0.25;
    try {
      const animator = new ViewmodelAnimator();
      animator.update(dtSec, idle);
      animator.playPreview('reload', 1);
      for (let i = 0; i < 60; i++) animator.update(dtSec, idle); // 1 s of real time is only 0.25 s of animation
      animator.update(dtSec, idle);
      expect(animator.pose.handZ).toBeGreaterThan(0.1); // still early in the reload (reaching)
    } finally {
      viewmodelConfig.slowMotionScale = viewmodelConfigDefaults.slowMotionScale;
    }
  });

  it('switching weapon clears the kick of the old one', () => {
    const animator = new ViewmodelAnimator();
    animator.fired('rifle');
    animator.update(dtSec, idle);
    animator.update(dtSec, { ...idle, weapon: 'pistol' });
    expect(animator.pose.z).toBe(0);
    expect(animator.pose.slideZ).toBe(0);
  });
});

describe('progress from the rules', () => {
  const events = new EventBus<WeaponEvents>();

  it('a gun reports how far through its reload it is, and 0 when not reloading', () => {
    const gun = new Gun(events, 'rifle', { ...rifleConfig }, true);
    for (let i = 0; i < 10; i++) gun.update(dtSec, { triggerHeld: true, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true });
    expect(gun.reloadProgress).toBe(0);
    gun.update(dtSec, { triggerHeld: false, triggerPressed: false, reloadPressed: true, checkRequested: false, canFire: true });
    expect(gun.reloading).toBe(true);
    const steps = Math.round(rifleConfig.reloadTimeSec / dtSec / 2);
    for (let i = 0; i < steps; i++) gun.update(dtSec, { triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true });
    expect(gun.reloadProgress).toBeGreaterThan(0.4);
    expect(gun.reloadProgress).toBeLessThan(0.65);
    gun.interrupt();
    expect(gun.reloadProgress).toBe(0);
  });

  it('the weapon set reports how far through the draw it is, and 1 when done', () => {
    const set = new WeaponSet(events, new Gun(events, 'rifle', rifleConfig, true), new Gun(events, 'pistol', pistolConfig, false), new Knife(events));
    expect(set.drawProgress).toBe(1);
    set.select('pistol');
    expect(set.drawProgress).toBe(0);
    const none = { select: null, wheelSteps: 0, triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true };
    for (let i = 0; i < Math.round(pistolConfig.drawTimeSec / dtSec / 2); i++) set.update(dtSec, none);
    expect(set.drawProgress).toBeGreaterThan(0.3);
    expect(set.drawProgress).toBeLessThan(0.7);
    for (let i = 0; i < 60; i++) set.update(dtSec, none);
    expect(set.drawProgress).toBe(1);
  });
});
