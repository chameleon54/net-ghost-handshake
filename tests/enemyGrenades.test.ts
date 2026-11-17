import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { aggressionConfig, aggressionSetting } from '../src/config/aggression';
import { enemyGrenadeConfig } from '../src/config/enemyGrenades';
import { grenadeConfig } from '../src/config/grenade';
import { squadConfig } from '../src/config/squad';
import { EventBus } from '../src/core/events';
import type { RoomBox } from '../src/data/greyboxRoom';
import { Dummy } from '../src/enemies/dummy';
import { lobIsClear, lobVelocity } from '../src/enemies/grenadeLob';
import { StandInEnemy } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import { CoverPoints, type CoverPoint } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { SquadCoordinator } from '../src/squad/squadCoordinator';
import type { WeaponEvents } from '../src/weapons/events';
import type { BlastTarget } from '../src/weapons/grenade/blast';
import { Grenade, type GrenadeHooks } from '../src/weapons/grenade/grenade';
import { dummyBlastTarget, GrenadeSystem } from '../src/weapons/grenade/grenadeSystem';

const dtSec = 1 / 60;
const farCrate: RoomBox = { kind: 'prop', xM: 80, zM: 80, widthM: 1, depthM: 1, heightM: 1 };
const collisionWith = (boxes: RoomBox[] = []) => buildGreybox([farCrate, ...boxes]).collision;

/** Flies a grenade (an enemy's) until it has landed, and returns where it first touched down. */
function landingOf(from: Vector3, velocity: Vector3, boxes: RoomBox[] = []): Vector3 {
  const collision = collisionWith(boxes);
  const grenade = new Grenade();
  const hooks: GrenadeHooks = { onBounce: () => {}, onExplode: () => {} };
  grenade.launch(from, velocity, true);
  for (let i = 0; i < 600 && !grenade.landed; i++) grenade.update(dtSec, collision, hooks);
  return grenade.position.clone();
}

describe('the lob (4.12)', () => {
  it('works out a throw that lands where it is aimed, at each angle tried', () => {
    const from = new Vector3(0, 1.75, -8);
    const to = new Vector3(1, 0.05, 0);
    for (const angleDeg of [30, 45, 60]) {
      const velocity = new Vector3();
      expect(lobVelocity(from, to, (angleDeg * Math.PI) / 180, grenadeConfig.gravityMps2, velocity)).toBe(true);
      const landed = landingOf(from, velocity);
      expect(Math.hypot(landed.x - to.x, landed.z - to.z), `${angleDeg} deg`).toBeLessThan(0.3);
    }
  });

  it('a higher angle climbs higher (a lob over cover), and an angle too flat for the climb gives no throw', () => {
    const from = new Vector3(0, 1.75, 0);
    const low = new Vector3();
    const high = new Vector3();
    lobVelocity(from, new Vector3(0, 0, 10), Math.PI / 6, grenadeConfig.gravityMps2, low);
    lobVelocity(from, new Vector3(0, 0, 10), Math.PI / 3, grenadeConfig.gravityMps2, high);
    expect(high.y / Math.hypot(high.x, high.z)).toBeGreaterThan(low.y / Math.hypot(low.x, low.z));
    // A target 10 m up and 2 m away cannot be reached at 30 degrees.
    expect(lobVelocity(from, new Vector3(0, 11.75, 2), Math.PI / 6, grenadeConfig.gravityMps2, low)).toBe(false);
  });

  it('a flight that strikes a wall on the way is not clear; one that lands behind low cover is', () => {
    const from = new Vector3(0, 1.75, -8);
    const to = new Vector3(0, 0.05, 0);
    const velocity = new Vector3();
    lobVelocity(from, to, Math.PI / 3, grenadeConfig.gravityMps2, velocity);
    const tallWall: RoomBox = { kind: 'wall', xM: 0, zM: -6.5, widthM: 20, depthM: 0.3, heightM: 8 };
    const lowCrate: RoomBox = { kind: 'prop', xM: 0, zM: -1.2, widthM: 2, depthM: 0.6, heightM: 1 };
    const { gravityMps2 } = grenadeConfig;
    const tolerance = enemyGrenadeConfig.throwLandToleranceM;
    expect(lobIsClear(from, velocity, to, gravityMps2, collisionWith([tallWall]), tolerance)).toBe(false);
    expect(lobIsClear(from, velocity, to, gravityMps2, collisionWith([lowCrate]), tolerance)).toBe(true);
  });
});

describe('an enemy grenade (4.12)', () => {
  it('counts its fuse from when it lands, not from the throw', () => {
    const collision = collisionWith();
    const explosions: number[] = [];
    let clockSec = 0;
    const hooks: GrenadeHooks = { onBounce: () => {}, onExplode: () => explosions.push(clockSec) };
    const grenade = new Grenade();
    grenade.launch(new Vector3(0, 3, 0), new Vector3(0, 0, 0), true); // falls about 0.8 s first
    let landedAtSec = Infinity;
    for (let i = 0; i < 60 * 6 && explosions.length === 0; i++) {
      clockSec += dtSec;
      grenade.update(dtSec, collision, hooks);
      if (grenade.landed) landedAtSec = Math.min(landedAtSec, clockSec);
    }
    expect(landedAtSec).toBeGreaterThan(0.5);
    expect(explosions).toHaveLength(1);
    expect(explosions[0] - landedAtSec).toBeCloseTo(enemyGrenadeConfig.fuseSec, 1);
  });

  it('beeps all along, closer together as its fuse runs out; Rook\'s own never beeps', () => {
    const collision = collisionWith();
    const beeps: number[] = [];
    let clockSec = 0;
    const hooks: GrenadeHooks = { onBounce: () => {}, onExplode: () => {}, onBeep: () => beeps.push(clockSec) };
    const enemy = new Grenade();
    enemy.launch(new Vector3(0, 1, 0), new Vector3(0, 0, 0), true);
    for (let i = 0; i < 60 * 5 && enemy.active; i++) {
      clockSec += dtSec;
      enemy.update(dtSec, collision, hooks);
    }
    expect(beeps.length).toBeGreaterThan(5);
    const firstGapSec = beeps[1] - beeps[0];
    const lastGapSec = beeps[beeps.length - 1] - beeps[beeps.length - 2];
    expect(lastGapSec).toBeLessThan(firstGapSec / 2);
    beeps.length = 0;
    const own = new Grenade();
    own.launch(new Vector3(0, 1, 0), new Vector3(0, 0, 0));
    for (let i = 0; i < 60 * 4; i++) own.update(dtSec, collision, hooks);
    expect(beeps).toHaveLength(0);
  });
});

describe('SquadCoordinator: enemy grenades (4.12)', () => {
  afterEach(() => {
    aggressionSetting.current = 'assertive';
  });

  /** Rook holds the same spot for `seconds`. */
  const hold = (squad: SquadCoordinator, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) squad.update(dtSec, { x: 0, z: 0 });
  };

  it('is due only after Rook has held one spot for the tier\'s grenade hold, longer than the flank\'s', () => {
    const squad = new SquadCoordinator();
    const { holdBeforeGrenadeSec, holdBeforeFlankSec } = aggressionConfig.assertive;
    expect(holdBeforeGrenadeSec).toBeGreaterThan(holdBeforeFlankSec);
    hold(squad, holdBeforeGrenadeSec - 0.5);
    expect(squad.grenadeDue(false)).toBe(false);
    hold(squad, 1);
    expect(squad.grenadeDue(false)).toBe(true);
    expect(squad.grenadeDue(true)).toBe(false); // one enemy grenade at a time
  });

  it('moving along one piece of cover keeps the grenade clock running (wider radius), while the flank clock restarts', () => {
    const squad = new SquadCoordinator();
    const shuffleM = (squadConfig.holdRadiusM + enemyGrenadeConfig.grenadeHoldRadiusM) / 2; // past the flank's radius, within the grenade's
    let x = 0;
    for (let i = 0; i < Math.round((aggressionConfig.assertive.holdBeforeGrenadeSec + 1) / dtSec); i++) {
      if (i % 60 === 0) x = x === 0 ? shuffleM : 0; // a step left or right every second
      squad.update(dtSec, { x, z: 0 });
    }
    expect(squad.heldSec).toBeLessThan(1.5); // the flank's clock keeps restarting
    expect(squad.grenadeDue(false)).toBe(true);
    // Leaving for good (beyond the grenade's radius) restarts the grenade clock too.
    squad.update(dtSec, { x: -(enemyGrenadeConfig.grenadeHoldRadiusM + 1), z: 0 }); // the spot settled at one end of the shuffle
    expect(squad.grenadeHeldSec).toBe(0);
    expect(squad.grenadeDue(false)).toBe(false);
  });

  it('never at Cautious', () => {
    aggressionSetting.current = 'cautious';
    const squad = new SquadCoordinator();
    hold(squad, 60);
    expect(squad.grenadeDue(false)).toBe(false);
  });

  it('waits while a flank is under way', () => {
    const squad = new SquadCoordinator();
    hold(squad, aggressionConfig.assertive.holdBeforeGrenadeSec + 1);
    squad.assignFlank([{}], () => ({ cost: 1 }));
    expect(squad.grenadeDue(false)).toBe(false);
  });

  it('gives the throw to the cheapest plan; after a throw it waits the cooldown, after a called-off one only the retry', () => {
    const squad = new SquadCoordinator();
    hold(squad, aggressionConfig.assertive.holdBeforeGrenadeSec + 1);
    const [near, far] = [{}, {}];
    const job = squad.assignGrenade([far, near], (member) => ({ cost: member === near ? 5 : 12 }));
    expect(job?.member).toBe(near);
    expect(squad.thrower).toBe(near);
    expect(squad.grenadeDue(false)).toBe(false); // one throw at a time
    squad.grenadeOver(near, true);
    expect(squad.thrower).toBeNull();
    expect(squad.grenadeWaitSec).toBe(aggressionConfig.assertive.grenadeCooldownSec);
    hold(squad, aggressionConfig.assertive.grenadeCooldownSec - 0.5);
    expect(squad.grenadeDue(false)).toBe(false);
    hold(squad, 1);
    expect(squad.grenadeDue(false)).toBe(true);
    squad.assignGrenade([near], () => ({ cost: 1 }));
    squad.grenadeOver(near, false);
    expect(squad.grenadeWaitSec).toBe(enemyGrenadeConfig.throwRetrySec);
  });

  it('with nobody able to throw it says why and tries again later', () => {
    const squad = new SquadCoordinator();
    hold(squad, aggressionConfig.assertive.holdBeforeGrenadeSec + 1);
    expect(squad.assignGrenade([{}], () => null)).toBeNull();
    expect(squad.grenadeFailure).toBe('no clear lob in range');
    expect(squad.grenadeDue(false)).toBe(false);
    hold(squad, enemyGrenadeConfig.throwRetrySec + 0.1);
    expect(squad.grenadeDue(false)).toBe(true);
    expect(squad.assignGrenade([], () => null)).toBeNull();
    expect(squad.grenadeFailure).toContain('nobody can throw');
  });

  it('"Grenade now" makes one due at once', () => {
    const squad = new SquadCoordinator();
    hold(squad, 1);
    squad.forceGrenade();
    expect(squad.grenadeDue(false)).toBe(true);
  });
});

describe('planning a throw in a built room (4.12)', () => {
  const rookAt = (xM: number, zM: number) => ({
    position: new Vector3(xM, 0, zM),
    eyeHeightNowM: 1.6,
    eyes: new Vector3(xM, 1.6, zM),
    forward: new Vector3(0, 0, -1),
    inView: () => true,
    exposure: 0,
    movingFast: false,
  });
  // A trooper crouched behind low cover 8 m north of Rook, facing him.
  const spot: CoverPoint = { xM: 0, zM: -8, height: 'low', facingYawRad: Math.PI };
  const lowCrate: RoomBox = { kind: 'prop', xM: 0, zM: -1.2, widthM: 2, depthM: 0.6, heightM: 1 }; // Rook hides behind it

  function plan(boxes: RoomBox[], rook = rookAt(0, 0)) {
    const collision = collisionWith(boxes);
    const cover = new CoverPoints([spot], collision);
    const launched: { from: Vector3; velocity: Vector3 }[] = [];
    const world = new StandInWorld(new EventBus<WeaponEvents>(), collision, Navigation.unavailable(), cover, rook, () => {}, () => [], () => 0.5, new SquadCoordinator(), (from, velocity) =>
      launched.push({ from: from.clone(), velocity: velocity.clone() }),
    );
    const enemy = new StandInEnemy({ xM: 0, zM: -8, yawRad: Math.PI }, world);
    return { world, enemy, launched, rook, plan: world.planThrow(enemy, spot) };
  }

  it('lobs over Rook\'s cover to land near his feet, from the peek it will come out of', () => {
    const { plan: throwPlan, world, enemy, launched } = plan([lowCrate]);
    expect(throwPlan).not.toBeNull();
    if (!throwPlan) return;
    expect(throwPlan.way).toBe(0); // low cover: it rises to throw
    expect(throwPlan.cost).toBeCloseTo(8, 5);
    const landed = landingOf(throwPlan.from, throwPlan.velocity, [lowCrate]);
    expect(Math.hypot(landed.x, landed.z)).toBeLessThan(enemyGrenadeConfig.throwScatterM + enemyGrenadeConfig.throwLandToleranceM);
    world.throwGrenade(enemy, throwPlan);
    expect(launched).toHaveLength(1);
  });

  it('no throw through a wall too tall to lob over, or from out of range', () => {
    const tallWall: RoomBox = { kind: 'wall', xM: 0, zM: -6.5, widthM: 20, depthM: 0.3, heightM: 8 };
    expect(plan([tallWall]).plan).toBeNull();
    expect(plan([], rookAt(0, enemyGrenadeConfig.throwMaxM)).plan).toBeNull(); // more than 18 m from the spot
    expect(plan([], rookAt(0, -8 + enemyGrenadeConfig.throwMinM - 1)).plan).toBeNull(); // closer than 4 m
  });

  it('the throw is called off if Rook has moved away since it was planned', () => {
    const { world, enemy, plan: throwPlan, rook } = plan([lowCrate]);
    if (!throwPlan) throw new Error('expected a plan');
    expect(world.throwStillOn(enemy, throwPlan)).toBe(true);
    rook.position.x += enemyGrenadeConfig.throwCancelMovedM + 0.1;
    expect(world.throwStillOn(enemy, throwPlan)).toBe(false);
  });
});

describe('the grenade system with enemy grenades (4.12)', () => {
  function setup() {
    const events = new EventBus<WeaponEvents>();
    const seen = { thrown: 0, beeps: 0, hitMarkers: 0, exploded: 0 };
    events.on('enemy:grenade-thrown', () => seen.thrown++);
    events.on('grenade:beep', () => seen.beeps++);
    events.on('target:hit', () => seen.hitMarkers++);
    events.on('grenade:exploded', () => seen.exploded++);
    const dummy = new Dummy(0, 1.5, 0);
    const player: BlastTarget = { chest: (out) => out.set(50, 1, 50), vulnerable: () => true, hurt: () => {} };
    const system = new GrenadeSystem(new Scene(), events, collisionWith(), new PerspectiveCamera(), [dummyBlastTarget(dummy, events)], player);
    return { system, seen, dummy };
  }

  it('flies an enemy grenade, says it was thrown, beeps, and its blast hurts enemies without a hit marker for Rook', () => {
    const { system, seen, dummy } = setup();
    system.throwEnemyGrenade(new Vector3(0, 1.5, 0), new Vector3(0, 2, 0));
    expect(seen.thrown).toBe(1);
    expect(system.enemyGrenadeLive).toBe(true);
    expect(system.liveEnemyGrenades()).toHaveLength(1);
    for (let i = 0; i < 60 * 6 && seen.exploded === 0; i++) system.update(dtSec);
    expect(seen.exploded).toBe(1);
    expect(seen.beeps).toBeGreaterThan(3);
    expect(dummy.health.current).toBeLessThan(dummy.health.max); // friendly fire (decision 249)
    expect(seen.hitMarkers).toBe(0);
    expect(system.enemyGrenadeLive).toBe(false);
  });

  it('enemies react to an enemy grenade only once it has landed, not while it leaves the thrower\'s hand', () => {
    const { system } = setup();
    system.throwEnemyGrenade(new Vector3(0, 1.5, 0), new Vector3(0, 2, 0));
    expect(system.livePositions()).toHaveLength(0); // in the air, right by the thrower
    for (let i = 0; i < 60 * 2; i++) system.update(dtSec);
    expect(system.livePositions()).toHaveLength(1);
  });

  it('a restart clears enemy grenades too', () => {
    const { system } = setup();
    system.throwEnemyGrenade(new Vector3(0, 1.5, 0), new Vector3(0, 2, 0));
    system.clear();
    expect(system.enemyGrenadeLive).toBe(false);
  });
});
