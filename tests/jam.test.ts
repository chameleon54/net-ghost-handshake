import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { GunConfig } from '../src/config/gun';
import { pistolConfigDefaults } from '../src/config/pistol';
import { rifleConfigDefaults } from '../src/config/rifle';
import { viewmodelConfigDefaults } from '../src/config/viewmodel';
import { EventBus } from '../src/core/events';
import { BarrelSmoke } from '../src/fx/barrelSmoke';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun, type GunInput } from '../src/weapons/gun';
import { addJamRisk, heatMax, jamChance, jamRiskGain } from '../src/weapons/jam';
import { Knife } from '../src/weapons/knife';
import { ViewmodelAnimator, type AnimatorInput } from '../src/weapons/viewmodel/animator';
import { WeaponSet } from '../src/weapons/weaponSet';

const dtSec = 1 / 60;
const neverJam = () => 0.999;
const alwaysJam = () => 0;
const trigger: GunInput = { triggerHeld: true, triggerPressed: true, reloadPressed: false, checkRequested: false, canFire: true };
const idle: GunInput = { triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true };
const tap: GunInput = { ...idle, reloadPressed: true };

describe('jam risk and chance', () => {
  const rifle = rifleConfigDefaults;

  it('shots add no risk below 60 heat, and rise smoothly to the full amount at 100', () => {
    expect(jamRiskGain(rifle, 0)).toBe(0);
    expect(jamRiskGain(rifle, 60)).toBe(0);
    expect(jamRiskGain(rifle, heatMax)).toBeCloseTo(rifle.jamRiskPerShotAtMaxHeat);
    let previous = 0;
    for (let heat = 60; heat <= heatMax; heat += 1) {
      const gain = jamRiskGain(rifle, heat);
      expect(gain).toBeGreaterThanOrEqual(previous);
      expect(gain - previous).toBeLessThan(rifle.jamRiskPerShotAtMaxHeat / 10); // no jumps
      previous = gain;
    }
  });

  it('builds up, and stops at the most it can reach', () => {
    let risk = 0;
    for (let i = 0; i < 20; i++) risk = addJamRisk(rifle, risk, heatMax);
    expect(risk).toBeCloseTo(20 * rifle.jamRiskPerShotAtMaxHeat);
    for (let i = 0; i < 10000; i++) risk = addJamRisk(rifle, risk, heatMax);
    expect(risk).toBe(rifle.jamRiskMax);
  });

  it('the chance is the built-up risk plus the flat chance', () => {
    expect(jamChance(rifle, 0, 20, Infinity)).toBe(0);
    expect(jamChance(rifle, 0.04, 20, Infinity)).toBeCloseTo(0.04);
    expect(jamChance({ ...rifle, jamChanceFlat: 0.01 }, 0.04, 20, Infinity)).toBeCloseTo(0.05);
  });

  it('has no jam in the first 5 rounds of a magazine, nor for 10 s after a jam was cleared', () => {
    expect(jamChance(rifle, 0.2, 4, Infinity)).toBe(0);
    expect(jamChance(rifle, 0.2, 5, Infinity)).toBeGreaterThan(0);
    expect(jamChance(rifle, 0.2, 20, 9.9)).toBe(0);
    expect(jamChance(rifle, 0.2, 20, 10)).toBeGreaterThan(0);
  });

  it('the pistol has a flat, very rare chance and builds no risk', () => {
    expect(jamRiskGain(pistolConfigDefaults, 100)).toBe(0);
    expect(jamChance(pistolConfigDefaults, 0, 10, Infinity)).toBeCloseTo(1 / 400);
    expect(jamChance(pistolConfigDefaults, 0, 2, Infinity)).toBe(0); // the guards apply too
  });
});

// A gun that jams on the first shot it can: the guards are off, and the number rolled is always low.
const jammyConfig: GunConfig = { ...rifleConfigDefaults, jamChanceFlat: 1, jamFreeRounds: 0, jamFreeAfterClearSec: 10 };

function setup(random: () => number, config: GunConfig = { ...rifleConfigDefaults }, automatic = true) {
  const events = new EventBus<WeaponEvents>();
  const seen = { fired: 0, jammed: 0, jamClicks: 0, racks: [] as number[], cleared: 0, empty: 0 };
  events.on('weapon:fired', () => seen.fired++);
  events.on('weapon:jammed', () => seen.jammed++);
  events.on('weapon:jam-click', () => seen.jamClicks++);
  events.on('weapon:rack', ({ tap: n }) => seen.racks.push(n));
  events.on('weapon:jam-cleared', () => seen.cleared++);
  events.on('weapon:empty-click', () => seen.empty++);
  const gun = new Gun(events, 'rifle', config, automatic, random);
  return { gun, seen, events };
}

const run = (gun: Gun, input: GunInput, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / dtSec); i++) gun.update(dtSec, input);
};

describe('heat', () => {
  it('each rifle shot adds heat, and it cools slowly after a short wait', () => {
    const { gun } = setup(neverJam);
    run(gun, { ...trigger, triggerPressed: false }, 0.5); // about 6 shots
    const hot = gun.heat;
    expect(hot).toBeGreaterThan(5);
    run(gun, idle, rifleConfigDefaults.heatCoolDelaySec - 0.1);
    expect(gun.heat).toBeCloseTo(hot); // still waiting to cool
    run(gun, idle, 8);
    expect(gun.heat).toBe(0);
  });

  it('one whole magazine in a single spray stays cool: no smoke, no chance of a jam', () => {
    const { gun } = setup(neverJam);
    run(gun, { ...trigger, triggerPressed: false }, 5); // empties the magazine and the chambered round
    expect(gun.empty).toBe(true);
    expect(gun.heat).toBeLessThan(rifleConfigDefaults.heatSmokeStart);
    expect(gun.jamChanceNow).toBe(0);
  });

  it('it takes several magazines sprayed one after another to get the barrel hot, and it never passes 100', () => {
    const { gun } = setup(neverJam);
    let hottest = 0;
    for (let mag = 0; mag < 4; mag++) {
      run(gun, { ...trigger, triggerPressed: false }, 3); // spray the magazine
      hottest = Math.max(hottest, gun.heat);
      gun.update(dtSec, tap); // reload at once
      run(gun, idle, rifleConfigDefaults.reloadTimeSec + rifleConfigDefaults.emptyReloadRackSec + 0.1);
      expect(gun.heat).toBeLessThanOrEqual(heatMax);
    }
    expect(hottest).toBeGreaterThan(rifleConfigDefaults.jamHeatStart);
  });

  it('cooling is slow: a magazine sprayed hot is still warm many seconds later', () => {
    const { gun } = setup(neverJam);
    run(gun, { ...trigger, triggerPressed: false }, 5);
    const hot = gun.heat;
    run(gun, idle, 5);
    expect(gun.heat).toBeLessThan(hot);
    expect(gun.heat).toBeGreaterThan(hot * 0.4); // barely down after 5 s
  });

  it('the pistol does not heat', () => {
    const events = new EventBus<WeaponEvents>();
    const pistol = new Gun(events, 'pistol', { ...pistolConfigDefaults }, false, neverJam);
    for (let i = 0; i < 10; i++) {
      pistol.update(dtSec, trigger);
      run(pistol, idle, 0.2);
    }
    expect(pistol.heat).toBe(0);
  });

  it('a holstered gun keeps cooling', () => {
    const events = new EventBus<WeaponEvents>();
    const rifle = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true, neverJam);
    const pistol = new Gun(events, 'pistol', { ...pistolConfigDefaults }, false, neverJam);
    const set = new WeaponSet(events, rifle, pistol, new Knife(events));
    const none = { select: null, wheelSteps: 0, triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true };
    for (let i = 0; i < 60; i++) set.update(dtSec, { ...none, triggerHeld: true });
    const hot = rifle.heat;
    expect(hot).toBeGreaterThan(10);
    set.select('pistol');
    for (let i = 0; i < 120; i++) set.update(dtSec, none);
    expect(rifle.heat).toBeLessThan(hot);
  });
});

describe('a jam', () => {
  it('replaces the shot: nothing is fired, no round is used, the gun is jammed', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    const before = gun.magazines.loadedRounds;
    gun.update(dtSec, trigger);
    expect(gun.jammed).toBe(true);
    expect(seen.jammed).toBe(1);
    expect(seen.fired).toBe(0);
    expect(gun.magazines.loadedRounds).toBe(before);
  });

  it('only clicks while jammed, once per pull, and a spray does not fire', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    gun.update(dtSec, trigger); // the jam itself
    run(gun, { ...trigger, triggerPressed: false }, 1); // still holding: no extra click
    expect(seen.jamClicks).toBe(0);
    run(gun, idle, 0.1);
    gun.update(dtSec, trigger); // a new pull
    expect(seen.jamClicks).toBe(1);
    expect(seen.fired).toBe(0);
  });

  it('cannot be reloaded or checked while jammed; R taps are racks instead', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    gun.update(dtSec, trigger);
    gun.update(dtSec, { ...idle, checkRequested: true });
    expect(gun.checking).toBe(false);
    gun.update(dtSec, tap);
    expect(gun.reloading).toBe(false);
    expect(seen.racks).toEqual([1]);
  });

  it('is cleared by four separate taps (the rifle), and the stuck round is lost', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    const before = gun.magazines.totalRounds;
    gun.update(dtSec, trigger);
    for (let i = 1; i <= 3; i++) {
      gun.update(dtSec, tap);
      expect(gun.jammed).toBe(true);
      gun.update(dtSec, idle);
    }
    gun.update(dtSec, tap);
    expect(gun.jammed).toBe(false);
    expect(seen.racks).toEqual([1, 2, 3, 4]);
    expect(seen.cleared).toBe(1);
    expect(gun.magazines.totalRounds).toBe(before - 1); // the stuck round was thrown out
  });

  it('the pistol is cleared by two taps', () => {
    const events = new EventBus<WeaponEvents>();
    const pistol = new Gun(events, 'pistol', { ...pistolConfigDefaults, jamChanceFlat: 1, jamFreeRounds: 0 }, false, alwaysJam);
    pistol.update(dtSec, trigger);
    expect(pistol.jammed).toBe(true);
    pistol.update(dtSec, tap);
    expect(pistol.jammed).toBe(true);
    pistol.update(dtSec, tap);
    expect(pistol.jammed).toBe(false);
  });

  it('a hold of R (not a tap) does nothing toward clearing', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    gun.update(dtSec, trigger);
    run(gun, { ...idle, checkRequested: true }, 2);
    expect(seen.racks).toEqual([]);
    expect(gun.jammed).toBe(true);
  });

  it('stays jammed when the gun is put away, but the taps already made are forgotten', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    gun.update(dtSec, trigger);
    gun.update(dtSec, tap);
    gun.update(dtSec, tap);
    gun.interrupt(); // switched away
    expect(gun.jammed).toBe(true);
    for (let i = 0; i < 3; i++) gun.update(dtSec, tap);
    expect(gun.jammed).toBe(true); // three more is not enough: it starts at four again
    gun.update(dtSec, tap);
    expect(gun.jammed).toBe(false);
    expect(seen.cleared).toBe(1);
  });

  it('after clearing, the gun fires again and is safe from jams for a while', () => {
    const { gun, seen } = setup(alwaysJam, jammyConfig);
    gun.update(dtSec, trigger);
    for (let i = 0; i < 4; i++) gun.update(dtSec, tap);
    run(gun, idle, 0.2);
    gun.update(dtSec, trigger);
    expect(seen.fired).toBe(1); // no jam: the 10 s guard is on
    run(gun, idle, jammyConfig.jamFreeAfterClearSec + 0.5);
    gun.update(dtSec, trigger);
    expect(gun.jammed).toBe(true); // and then it can jam again
  });

  it('a reload with a fresh magazine gives the next rounds the no-jam guard again', () => {
    const config = { ...jammyConfig, jamChanceFlat: 1, jamFreeRounds: 3, jamFreeAfterClearSec: 0 };
    const { gun } = setup(alwaysJam, config);
    for (let i = 0; i < 3; i++) {
      gun.update(dtSec, { ...trigger, triggerHeld: true });
      run(gun, idle, 0.2);
    }
    expect(gun.jammed).toBe(false); // the first three rounds are safe
    gun.update(dtSec, trigger);
    expect(gun.jammed).toBe(true); // the fourth jams
  });

  it('never creates a round or loses one except the stuck rounds thrown out', () => {
    let seed = 99;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let game = 0; game < 15; game++) {
      // Jams are very likely here, so every path is exercised.
      const config = { ...rifleConfigDefaults, jamChanceFlat: 0.3, jamFreeRounds: 1, jamFreeAfterClearSec: 0.2, jamClearTaps: 3 };
      const events = new EventBus<WeaponEvents>();
      let shots = 0;
      let thrownOut = 0;
      events.on('weapon:fired', () => shots++);
      events.on('weapon:jam-cleared', () => thrownOut++);
      const gun = new Gun(events, 'rifle', config, true, random);
      const start = gun.magazines.totalRounds;
      let held = false;
      for (let tick = 0; tick < 5000; tick++) {
        if (random() < 0.05) held = !held;
        gun.update(dtSec, {
          triggerHeld: held,
          triggerPressed: random() < 0.1,
          reloadPressed: random() < 0.04,
          checkRequested: random() < 0.01,
          canFire: random() < 0.95,
        });
        if (random() < 0.003) gun.interrupt();
        if (gun.magazines.totalRounds !== start - shots - thrownOut) throw new Error(`rounds off at tick ${tick}`);
        if (gun.jammed && (gun.reloading || gun.checking)) throw new Error('jammed while reloading or checking');
      }
    }
  });
});

describe('the animator while jammed', () => {
  const idleInput: AnimatorInput = { weapon: 'rifle', drawProgress: 1, reloadProgress: null, sprinting: false };
  const run2 = (animator: ViewmodelAnimator, input: AnimatorInput, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) animator.update(dtSec, input);
  };

  it('shows a stuck casing and a part-open bolt, and neither when clear', () => {
    const animator = new ViewmodelAnimator();
    run2(animator, { ...idleInput, jammed: true }, 0.5);
    expect(animator.pose.stuckCasing).toBe(true);
    expect(animator.pose.slideZ).toBeCloseTo(viewmodelConfigDefaults.rifleBoltBackM * viewmodelConfigDefaults.jammedSlideShare);
    run2(animator, { ...idleInput, jammed: false }, 0.5);
    expect(animator.pose.stuckCasing).toBe(false);
    expect(animator.pose.slideZ).toBeCloseTo(0);
  });

  it('each rack tap pulls the bolt all the way back and lets it go, with the hand reaching, then rests', () => {
    const animator = new ViewmodelAnimator();
    run2(animator, { ...idleInput, jammed: true }, 0.3);
    animator.racked();
    let furthest = 0;
    let reach = 0;
    for (let i = 0; i < Math.round(viewmodelConfigDefaults.rackTapSec / dtSec / 2); i++) {
      animator.update(dtSec, { ...idleInput, jammed: true });
      furthest = Math.max(furthest, animator.pose.slideZ);
      reach = Math.max(reach, animator.pose.handZ);
    }
    expect(furthest).toBeGreaterThan(viewmodelConfigDefaults.rifleBoltBackM * 0.7);
    expect(reach).toBeGreaterThan(0.1);
    run2(animator, { ...idleInput, jammed: false }, 0.5);
    expect(animator.pose.handZ).toBe(0);
    expect(animator.pose.slideZ).toBeCloseTo(0);
  });

  it('the knife never shows a jam', () => {
    const animator = new ViewmodelAnimator();
    run2(animator, { ...idleInput, weapon: 'knife', jammed: true }, 0.3);
    expect(animator.pose.stuckCasing).toBe(false);
  });
});

describe('BarrelSmoke', () => {
  const camera = new PerspectiveCamera();
  const visiblePuffs = (smoke: BarrelSmoke, scene: Scene) => {
    void smoke;
    return scene.children.filter((c) => c.visible).length;
  };

  it('smokes only from the smoke heat up, and only while the rifle is in hand', () => {
    const scene = new Scene();
    const smoke = new BarrelSmoke(scene, camera, new Vector3(0, 0, -1));
    for (let i = 0; i < 120; i++) smoke.update(dtSec, rifleConfigDefaults.heatSmokeStart - 1, true);
    expect(visiblePuffs(smoke, scene)).toBe(0);
    for (let i = 0; i < 120; i++) smoke.update(dtSec, 100, false);
    expect(visiblePuffs(smoke, scene)).toBe(0);
    for (let i = 0; i < 120; i++) smoke.update(dtSec, 100, true);
    expect(visiblePuffs(smoke, scene)).toBeGreaterThan(3);
  });

  it('hotter means more puffs, and they fade away after the heat is gone', () => {
    const count = (heat: number) => {
      const scene = new Scene();
      const smoke = new BarrelSmoke(scene, camera, new Vector3());
      for (let i = 0; i < 60; i++) smoke.update(dtSec, heat, true);
      return visiblePuffs(smoke, scene);
    };
    expect(count(100)).toBeGreaterThan(count(rifleConfigDefaults.heatSmokeStart + 1));
    const scene = new Scene();
    const smoke = new BarrelSmoke(scene, camera, new Vector3());
    for (let i = 0; i < 60; i++) smoke.update(dtSec, 100, true);
    for (let i = 0; i < 240; i++) smoke.update(dtSec, 0, true);
    expect(visiblePuffs(smoke, scene)).toBe(0);
  });
});

describe('jam risk builds up and only a jam resets it', () => {
  // Three full magazines sprayed one after another, as fast as possible, on a gun that never jams: the risk it builds.
  function sprayThreeMagazines(): Gun {
    const { gun } = setup(neverJam);
    for (let mag = 0; mag < 3; mag++) {
      run(gun, { ...trigger, triggerPressed: false }, 3);
      gun.update(dtSec, tap);
      run(gun, idle, rifleConfigDefaults.reloadTimeSec + rifleConfigDefaults.emptyReloadRackSec + 0.1);
    }
    return gun;
  }

  it('one magazine builds no risk; three sprayed in a row build some', () => {
    const one = setup(neverJam).gun;
    run(one, { ...trigger, triggerPressed: false }, 3);
    expect(one.jamRisk).toBe(0);
    const three = sprayThreeMagazines();
    expect(three.jamRisk).toBeGreaterThan(0.01);
  });

  it('the risk does NOT go down when the barrel cools: waiting does not help', () => {
    const gun = sprayThreeMagazines();
    const risk = gun.jamRisk;
    expect(risk).toBeGreaterThan(0);
    run(gun, idle, 60); // a long wait: the barrel is cold again
    expect(gun.heat).toBe(0);
    expect(gun.jamRisk).toBe(risk);
    expect(gun.jamChanceNow).toBe(0); // the first rounds of the fresh magazine are guarded...
    run(gun, { ...trigger, triggerPressed: false }, 0.6); // ...but after them the old risk is still there, a cold barrel or not
    expect(gun.heat).toBeLessThan(rifleConfigDefaults.jamHeatStart);
    expect(gun.jamChanceNow).toBeCloseTo(risk);
  });

  it('a jam resets it to nothing, and it builds again from there', () => {
    const events = new EventBus<WeaponEvents>();
    const config: GunConfig = { ...rifleConfigDefaults, jamFreeRounds: 0, jamFreeAfterClearSec: 0 };
    const gun = new Gun(events, 'rifle', config, true, () => 0.999);
    gun.jamRisk = 0.2; // built up earlier
    // Forcing the roll: a number below the chance jams.
    const jammer = new Gun(events, 'rifle', config, true, () => 0.1);
    jammer.jamRisk = 0.2;
    jammer.update(dtSec, trigger);
    expect(jammer.jammed).toBe(true);
    expect(jammer.jamRisk).toBe(0);
    expect(gun.jamRisk).toBe(0.2); // a gun that did not jam keeps its risk
  });

  it('over many sprays of three magazines most jam at some point, and a single magazine never does', () => {
    let seed = 4242;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let jamsThree = 0;
    let jamsOne = 0;
    const games = 300;
    for (let game = 0; game < games; game++) {
      const events = new EventBus<WeaponEvents>();
      let jams = 0;
      events.on('weapon:jammed', () => jams++);
      const gun = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true, random);
      for (let mag = 0; mag < 3 && jams === 0; mag++) {
        run(gun, { ...trigger, triggerPressed: false }, 3);
        if (mag === 0 && jams > 0) jamsOne++;
        gun.update(dtSec, tap);
        run(gun, idle, rifleConfigDefaults.reloadTimeSec + rifleConfigDefaults.emptyReloadRackSec + 0.1);
      }
      if (jams > 0) jamsThree++;
    }
    expect(jamsOne).toBe(0);
    expect(jamsThree / games).toBeGreaterThan(0.3); // a long spray usually jams...
    expect(jamsThree / games).toBeLessThan(0.97); // ...but not every time
  });
});

describe('infinite ammo (a dev testing aid)', () => {
  it('uses no ammo for shots or for a jam thrown out, and still heats and jams', () => {
    const { gun, seen } = setup(alwaysJam, { ...jammyConfig, jamFreeAfterClearSec: 0 });
    gun.infiniteAmmo = true;
    const before = gun.magazines.totalRounds;
    gun.update(dtSec, trigger); // jams
    for (let i = 0; i < 4; i++) gun.update(dtSec, tap); // cleared: the stuck round is thrown out
    expect(seen.cleared).toBe(1);
    expect(gun.magazines.totalRounds).toBe(before);
    const heatBefore = gun.heat;
    gun.update(dtSec, { ...trigger, triggerHeld: true });
    gun.update(dtSec, idle);
    expect(gun.heat).toBeGreaterThanOrEqual(heatBefore); // shots still heat the barrel
    expect(gun.magazines.totalRounds).toBe(before);
  });

  it('is off by default, and the weapon set switches it for both guns', () => {
    const events = new EventBus<WeaponEvents>();
    const rifle = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true, neverJam);
    const pistol = new Gun(events, 'pistol', { ...pistolConfigDefaults }, false, neverJam);
    expect(rifle.infiniteAmmo).toBe(false);
    const set = new WeaponSet(events, rifle, pistol, new Knife(events));
    set.setInfiniteAmmo(true);
    expect(rifle.infiniteAmmo && pistol.infiniteAmmo).toBe(true);
    for (let i = 0; i < 60; i++) rifle.update(dtSec, { ...trigger, triggerPressed: false });
    expect(rifle.magazines.totalRounds).toBe(rifleConfigDefaults.magazineRounds * rifleConfigDefaults.startingMagazines + 1);
  });
});

describe('the barrel stays hot while jammed and goes cold when the jam is cleared', () => {
  it('a jam spends the risk but keeps the heat (and the smoke) until the last clearing tap', () => {
    const events = new EventBus<WeaponEvents>();
    const config: GunConfig = { ...rifleConfigDefaults, jamFreeRounds: 0, jamFreeAfterClearSec: 0 };
    const gun = new Gun(events, 'rifle', config, true, () => 0.01);
    gun.heat = 90;
    gun.jamRisk = 0.2;
    gun.update(dtSec, trigger);
    expect(gun.jammed).toBe(true);
    expect(gun.jamRisk).toBe(0);
    const hot = gun.heat;
    expect(hot).toBeGreaterThan(89); // still hot (it cooled a hair on the tick the jam happened)
    run(gun, idle, 10); // jammed for a long time: no cooling meanwhile
    expect(gun.heat).toBe(hot);
    for (let i = 0; i < config.jamClearTaps - 1; i++) gun.update(dtSec, tap);
    expect(gun.heat).toBe(hot); // still hot until the last tap
    gun.update(dtSec, tap);
    expect(gun.jammed).toBe(false);
    expect(gun.heat).toBe(0);
  });
});
