import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { standInConfig } from '../src/config/standInEnemy';
import { EventBus } from '../src/core/events';
import { StandInEnemy, type StandInHooks } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import type { RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { greyboxCover } from '../src/data/greyboxCover';
import { CoverPoints, type CoverPoint } from '../src/level/cover';
import { dummyConfig } from '../src/config/dummy';
import type { Noise } from '../src/stealth/noise';
import type { WeaponEvents } from '../src/weapons/events';

const dtSec = 1 / 60;
const spawn = { xM: 0, zM: 0, yawRad: 0 }; // faces north (-z)

/** A stand-in with fake senses. `roll` is what its random number gives: below the hit chance hits, above it misses. */
function setup(roll = 0.99) {
  /**
   * `route` (if set) replaces the straight line the fake navigation gives: the points after the start. `cover` is what
   * the fake cover service offers (none by default, so it behaves as in 4.1), and `coverHides` whether that spot still hides it.
   */
  const world = { sees: true, clockSec: 0, route: null as Vector3[] | null, cover: null as CoverPoint | null, coverHides: true, releases: 0 };
  const shots: { atSec: number; hits: boolean }[] = [];
  const hooks: StandInHooks = {
    canSeePlayer: () => world.sees,
    pushOut: () => {},
    fire: (_enemy, hits) => shots.push({ atSec: world.clockSec, hits }),
    findPath: (from, to, out) => {
      out.length = 0;
      out.push(from.clone(), ...(world.route ?? [to]).map((p) => p.clone()));
      return true;
    },
    pickCover: () => world.cover,
    coverHides: () => world.coverHides,
    releaseCover: () => world.releases++,
  };
  const enemy = new StandInEnemy(spawn, hooks, () => roll);
  const run = (player: Vector3, seconds: number) => {
    const steps = Math.round(seconds / dtSec);
    for (let i = 0; i < steps; i++) {
      world.clockSec += dtSec;
      enemy.update(dtSec, player);
    }
  };
  return { enemy, world, shots, run };
}

const noiseAt = (position: Vector3, radiusM: number): Noise => ({ kind: 'footstep', position, radiusM });

describe('StandInEnemy waking up', () => {
  it('stays idle, still and silent until something wakes it', () => {
    const { enemy, shots, run } = setup();
    run(new Vector3(0, 0, -5), 2);
    expect(enemy.state).toBe('idle');
    expect(enemy.feet.toArray()).toEqual([0, 0, 0]);
    expect(shots).toHaveLength(0);
  });

  it('wakes on a noise that carries to it, not on one that falls short', () => {
    const { enemy } = setup();
    enemy.hear(noiseAt(new Vector3(0, standInConfig.eyeHeightM, -5), 4));
    expect(enemy.state).toBe('idle');
    enemy.hear(noiseAt(new Vector3(0, standInConfig.eyeHeightM, -5), 6));
    expect(enemy.awake).toBe(true);
  });

  it('wakes when shot in the body; a headshot always kills', () => {
    const { enemy } = setup();
    expect(enemy.hit('body', 15)).toBe(false);
    expect(enemy.awake).toBe(true);
    expect(enemy.health.current).toBe(standInConfig.healthPoints - 15);
    expect(enemy.hit('head', 1)).toBe(true);
    expect(enemy.state).toBe('falling');
    expect(enemy.hittable).toBe(false);
  });

  it('is behind from the side it faces away from', () => {
    const { enemy } = setup();
    expect(enemy.isBehind(0, 3)).toBe(true); // south of a north-facing enemy
    expect(enemy.isBehind(0, -3)).toBe(false);
  });
});

describe('StandInEnemy walking and shooting', () => {
  it('walks straight at the player at its walk speed while it cannot see him, without firing', () => {
    const { enemy, world, shots, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -20), 1);
    expect(enemy.state).toBe('approach');
    expect(enemy.feet.z).toBeCloseTo(-standInConfig.walkSpeedMps, 1);
    expect(enemy.feet.x).toBeCloseTo(0, 5);
    expect(shots).toHaveLength(0);
  });

  it('keeps walking when it sees him far away, and stops to fire once he is within range', () => {
    const { enemy, run } = setup();
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -20), 0.5);
    expect(enemy.state).toBe('approach');
    const player = new Vector3(0, 0, enemy.feet.z - standInConfig.stopRangeM + 1);
    run(player, 0.1);
    expect(enemy.state).toBe('shoot');
    const stoppedAt = enemy.feet.clone();
    run(player, 2);
    expect(enemy.feet.distanceTo(stoppedAt)).toBe(0);
  });

  it('never walks closer than its closest distance (give or take one step)', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -3), 3);
    const stepM = standInConfig.walkSpeedMps * dtSec;
    expect(Math.abs(enemy.feet.z - -3)).toBeGreaterThan(standInConfig.closestM - stepM - 1e-9);
    expect(Math.abs(enemy.feet.z - -3)).toBeLessThanOrEqual(standInConfig.closestM + 1e-9);
  });

  it('follows its route point by point, facing the way it walks', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.route = [new Vector3(2, 0, 0), new Vector3(2, 0, -6)]; // east first, then north
    enemy.hit('body', 1);
    run(new Vector3(2, 0, -6), 0.4); // 1 m along the first leg
    expect(enemy.feet.x).toBeGreaterThan(0.5);
    expect(enemy.feet.z).toBeCloseTo(0, 5);
    expect(Math.sin(enemy.yawRad)).toBeLessThan(-0.9); // facing east (yaw -90 degrees)
    run(new Vector3(2, 0, -6), 1.2); // round the corner
    expect(enemy.feet.x).toBeCloseTo(2, 5);
    expect(enemy.feet.z).toBeLessThan(-0.5);
    const routeAhead = enemy.routeAhead([]);
    expect(routeAhead[0]).toBe(enemy.feet);
    expect(routeAhead[routeAhead.length - 1].toArray()).toEqual([2, 0, -6]);
  });

  it('shows no route while it stands and fires', () => {
    const { enemy, run } = setup();
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 0.2);
    expect(enemy.state).toBe('shoot');
    expect(enemy.routeAhead([])).toHaveLength(0);
  });

  it('waits its reaction time, then fires bursts with the set gaps', () => {
    const { enemy, shots, run } = setup();
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 2.5);
    const times = shots.map((s) => s.atSec);
    const { reactionSec, roundIntervalSec, burstPauseSec, burstRounds } = standInConfig;
    expect(times[0]).toBeCloseTo(reactionSec, 1);
    expect(times[1] - times[0]).toBeCloseTo(roundIntervalSec, 1);
    expect(times[burstRounds] - times[burstRounds - 1]).toBeCloseTo(burstPauseSec, 1);
  });

  it('turns to face the player before the reaction pause starts, so it never fires sideways', () => {
    const { enemy, shots, run } = setup();
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 5), 3); // he is right behind it
    const turnSec = (180 - standInConfig.aimToleranceDeg) / standInConfig.turnSpeedDegPerSec;
    expect(shots[0].atSec).toBeGreaterThan(turnSec + standInConfig.reactionSec - 2 * dtSec);
    expect(Math.abs(Math.sin(enemy.yawRad))).toBeLessThan(0.01); // facing south now
    expect(Math.cos(enemy.yawRad)).toBeLessThan(0);
  });

  it('keeps the hit budget: even when every roll would hit, only one round in any 0.5 s lands', () => {
    const { enemy, shots, run } = setup(0);
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 4);
    const hits = shots.filter((s) => s.hits).map((s) => s.atSec);
    expect(hits.length).toBeGreaterThan(1);
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(standInConfig.hitGapSec - 1e-9);
    expect(shots.slice(0, standInConfig.burstRounds).map((s) => s.hits)).toEqual([true, false, false]);
  });

  it('misses every round when the roll is above the hit chance', () => {
    const { enemy, shots, run } = setup(0.99);
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 4);
    expect(shots.length).toBeGreaterThan(3);
    expect(shots.every((s) => !s.hits)).toBe(true);
  });

  it('stands still and holds fire while frozen, but can still be killed', () => {
    const { enemy, shots, run } = setup();
    enemy.hit('body', 1);
    enemy.frozen = true;
    run(new Vector3(0, 0, -5), 2);
    expect(shots).toHaveLength(0);
    expect(enemy.feet.toArray()).toEqual([0, 0, 0]);
    expect(enemy.kill()).toBe(true);
  });
});

describe('StandInEnemy death and reset', () => {
  it('falls, lies down, then gets up at its spawn spot awake and at full health', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -20), 1);
    enemy.kill();
    run(new Vector3(0, 0, -20), standInConfig.fallTimeSec + 0.05);
    expect(enemy.state).toBe('down');
    expect(enemy.fallProgress).toBe(1);
    run(new Vector3(0, 0, -20), standInConfig.respawnDelaySec);
    expect(enemy.awake).toBe(true);
    expect(enemy.health.current).toBe(standInConfig.healthPoints);
    expect(Math.abs(enemy.feet.z)).toBeLessThan(0.1); // back at the spot (it may have taken one step)
  });

  it('a reset puts it back at its spot, idle and at full health', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hit('body', 50);
    run(new Vector3(0, 0, -20), 1);
    enemy.reset();
    expect(enemy.state).toBe('idle');
    expect(enemy.feet.toArray()).toEqual([0, 0, 0]);
    expect(enemy.yawRad).toBe(0);
    expect(enemy.health.current).toBe(standInConfig.healthPoints);
  });
});

describe('StandInEnemy and cover (4.3)', () => {
  const lowSpot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: 0 };
  const highSpot: CoverPoint = { xM: 3, zM: 0, height: 'high', facingYawRad: Math.PI / 2 };

  it('walks to its cover spot standing, then crouches behind low cover, faces it, and holds without firing', () => {
    const { enemy, world, shots, run } = setup();
    world.sees = false;
    world.cover = lowSpot;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 10), 0.5);
    expect(enemy.state).toBe('approach');
    expect(enemy.crouched).toBe(false);
    run(new Vector3(0, 0, 10), 2);
    expect(enemy.state).toBe('cover');
    expect(enemy.feet.distanceTo(new Vector3(0, 0, -3))).toBeLessThan(standInConfig.coverArriveM);
    expect(enemy.crouched).toBe(true);
    expect(enemy.heightM).toBe(standInConfig.crouchHeightM);
    expect(Math.cos(enemy.yawRad)).toBeGreaterThan(0.99); // facing its cover (north)
    run(new Vector3(0, 0, 10), 3);
    expect(enemy.state).toBe('cover');
    expect(shots).toHaveLength(0);
  });

  it('stands behind high cover', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.cover = highSpot;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 10), 3);
    expect(enemy.state).toBe('cover');
    expect(enemy.crouched).toBe(false);
    expect(enemy.heightM).toBe(dummyConfig.heightM);
  });

  it('keeps its spot while it hides it, and moves to a new one once it does not', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.cover = lowSpot;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 10), 3);
    world.cover = highSpot; // what it would pick now, but its spot still hides it
    run(new Vector3(0, 0, 10), 1);
    expect(enemy.cover).toBe(lowSpot);
    world.coverHides = false; // Rook moved: its spot no longer hides it
    run(new Vector3(0, 0, 10), 0.6);
    expect(enemy.cover).toBe(highSpot);
    expect(enemy.state).toBe('approach');
    expect(enemy.crouched).toBe(false); // it stands up to move
  });

  it('never fires while it walks to cover, even when it sees Rook beyond its stand-ground range', () => {
    const { enemy, world, shots, run } = setup(0);
    world.cover = { xM: 0, zM: -20, height: 'low', facingYawRad: 0 }; // far away, so it walks the whole time
    enemy.hit('body', 1);
    run(new Vector3(0, 0, standInConfig.standGroundM + 1), 3); // and it walks away from him
    expect(enemy.state).toBe('approach');
    expect(shots).toHaveLength(0);
  });

  it('fires from its spot if it can see Rook from there', () => {
    const { enemy, world, shots, run } = setup();
    world.sees = false;
    world.cover = lowSpot;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 10), 3);
    world.sees = true;
    run(new Vector3(0, 0, 10), 2);
    expect(enemy.state).toBe('cover');
    expect(shots.length).toBeGreaterThan(0);
  });

  it('lets go of its spot when it dies and when it is reset', () => {
    const { enemy, world, run } = setup();
    world.cover = lowSpot;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 10), 1);
    const before = world.releases;
    enemy.kill();
    expect(world.releases).toBe(before + 1);
    expect(enemy.cover).toBeNull();
    enemy.reset();
    expect(world.releases).toBe(before + 2);
  });
});

describe('StandInEnemy fighting back (4.3 follow-up)', () => {
  const firstSpot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: 0 };
  const nextSpot: CoverPoint = { xM: 0, zM: -9, height: 'high', facingYawRad: 0 };

  /** A stand-in holding `firstSpot`, hidden, with Rook at `rook`. */
  function inCover(roll = 0.99) {
    const s = setup(roll);
    s.world.sees = false;
    s.world.cover = firstSpot;
    s.enemy.hit('body', 1);
    s.run(new Vector3(0, 0, 20), 3);
    expect(s.enemy.state).toBe('cover');
    return s;
  }

  it('rushed up close, it stands and fights, then backs off to new cover still firing, slower and facing Rook', () => {
    const { enemy, world, shots, run } = inCover();
    const rook = new Vector3(0, 0, 1); // 4 m away
    world.sees = true;
    world.coverHides = false;
    world.cover = nextSpot;
    run(rook, 0.1);
    expect(enemy.state).toBe('fight');
    expect(enemy.crouched).toBe(false);
    run(rook, standInConfig.fightSec - 0.2);
    expect(enemy.state).toBe('fight'); // still fighting
    expect(shots.length).toBeGreaterThan(0);
    run(rook, 1.5); // the fight time is up and a burst has ended
    expect(enemy.state).toBe('retreat');
    expect(enemy.cover).toBe(nextSpot);
    const firedBefore = shots.length;
    const zBefore = enemy.feet.z;
    run(rook, 1);
    expect(shots.length).toBeGreaterThan(firedBefore); // it fires while backing off
    const movedM = zBefore - enemy.feet.z;
    expect(movedM).toBeGreaterThan(0);
    expect(movedM).toBeLessThanOrEqual(standInConfig.walkSpeedMps * standInConfig.retreatSpeedShare + 1e-6);
    expect(Math.cos(enemy.yawRad)).toBeLessThan(-0.9); // still facing Rook (south) while it walks north
    run(rook, 6);
    expect(enemy.feet.distanceTo(new Vector3(0, 0, -9))).toBeLessThan(standInConfig.coverArriveM + 0.05);
  });

  it('when its cover fails at range, it answers with exactly one burst, then walks to new cover without firing', () => {
    const { enemy, world, shots, run } = inCover();
    const rook = new Vector3(0, 0, 12); // 15 m away
    world.sees = true;
    world.coverHides = false;
    world.cover = nextSpot;
    run(rook, 0.6);
    expect(enemy.state).toBe('fight');
    run(rook, 1.5);
    expect(enemy.state).toBe('approach');
    expect(shots).toHaveLength(standInConfig.burstRounds);
    run(rook, 1);
    expect(shots).toHaveLength(standInConfig.burstRounds);
  });

  it('stops fighting when it loses sight of Rook, and goes on to cover', () => {
    const { enemy, world, run } = inCover();
    world.sees = true;
    world.coverHides = false;
    run(new Vector3(0, 0, 1), 0.3);
    expect(enemy.state).toBe('fight');
    world.sees = false;
    run(new Vector3(0, 0, 1), 0.3);
    expect(enemy.state === 'approach' || enemy.state === 'cover').toBe(true);
  });

  it('with no cover to back off to, it keeps fighting', () => {
    const { enemy, world, run } = inCover();
    world.sees = true;
    world.coverHides = false;
    world.cover = null;
    run(new Vector3(0, 0, 1), 5);
    expect(enemy.state).toBe('fight');
  });

  it('hits less often while backing off', () => {
    // A roll between the halved and the full hit chance: hits when standing, misses when moving.
    const roll = standInConfig.hitChance * (1 + standInConfig.retreatHitChanceShare) / 2;
    const { enemy, world, shots, run } = inCover(roll);
    const rook = new Vector3(0, 0, 1);
    world.sees = true;
    world.coverHides = false;
    world.cover = nextSpot;
    run(rook, standInConfig.fightSec + 1.5);
    expect(enemy.state).toBe('retreat');
    expect(shots.some((s) => s.hits)).toBe(true);
    const firedBefore = shots.length;
    run(rook, 2);
    expect(shots.length).toBeGreaterThan(firedBefore);
    expect(shots.slice(firedBefore).some((s) => s.hits)).toBe(false);
  });
});

describe('StandInWorld', () => {
  let navigation: Navigation;
  beforeAll(async () => {
    navigation = await Navigation.create(buildGreybox().navigationGeometry);
  });
  const farProp: RoomBox = { kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 };
  const backWall: RoomBox = { kind: 'wall', xM: 0, zM: 5, widthM: 20, depthM: 0.3, heightM: 8 }; // behind the player, tall enough to catch high misses
  const player = { position: new Vector3(0, 0, 0), eyeHeightNowM: 1.6, eyes: new Vector3(0, 1.6, 0) };

  const setupWorld = (boxes: RoomBox[]) => {
    const events = new EventBus<WeaponEvents>();
    const damage: number[] = [];
    const landed: { muzzle: Vector3; end: Vector3; hit: boolean; shooter: string }[] = [];
    const fired: Vector3[] = [];
    events.on('shot:landed', (s) => landed.push({ muzzle: s.muzzle.clone(), end: s.end.clone(), hit: s.hit, shooter: s.shooter }));
    events.on('enemy:fired', ({ position }) => fired.push(position.clone()));
    const { collision } = buildGreybox([farProp, ...boxes]);
    const world = new StandInWorld(events, collision, navigation, new CoverPoints([], collision), player, (amount) => damage.push(amount));
    const enemy = new StandInEnemy({ xM: 0, zM: -8, yawRad: Math.PI }, world); // 8 m north, facing south at him
    return { world, enemy, damage, landed, fired };
  };

  it('sees the player in the open, not through a wall', () => {
    expect(setupWorld([]).world.canSeePlayer(setupWorld([]).enemy)).toBe(true);
    const blocked = setupWorld([{ kind: 'wall', xM: 0, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 }]);
    expect(blocked.world.canSeePlayer(blocked.enemy)).toBe(false);
  });

  it('a hit hurts the player and lands on his chest; the shot is marked as an enemy shot', () => {
    const { world, enemy, damage, landed, fired } = setupWorld([backWall]);
    world.fire(enemy, true);
    expect(damage).toEqual([standInConfig.damagePerHit]);
    expect(landed[0].shooter).toBe('enemy');
    expect(landed[0].hit).toBe(false); // no bullet mark on the player
    expect(landed[0].end.toArray()).toEqual([0, 1.6 * standInConfig.aimHeightShareOfEyes, 0]);
    expect(fired[0].z).toBeCloseTo(-8 + standInConfig.muzzleForwardM, 5); // the muzzle is in front of it, toward him
  });

  it('a miss never hurts, passes 0.3 to 1.5 m from his chest, and ends on what is behind him', () => {
    const { world, enemy, damage, landed } = setupWorld([backWall]);
    const chest = new Vector3(0, 1.6 * standInConfig.aimHeightShareOfEyes, 0);
    const toChest = new Vector3();
    const direction = new Vector3();
    for (let i = 0; i < 200; i++) world.fire(enemy, false);
    expect(damage).toHaveLength(0);
    for (const shot of landed) {
      direction.subVectors(shot.end, shot.muzzle).normalize();
      toChest.subVectors(chest, shot.muzzle);
      // How far the bullet's line passes from his chest. The offset is set square to the shot at his distance, so the
      // line itself passes a hair closer (under 2% at this range).
      const passM = toChest.cross(direction).length();
      expect(passM).toBeGreaterThanOrEqual(standInConfig.missMinOffsetM * 0.98);
      expect(passM).toBeLessThanOrEqual(standInConfig.missMaxOffsetM + 1e-6);
      expect(shot.hit).toBe(true); // the back wall or the floor
    }
  });
});

describe('the stand-in in the real test room (4.2)', () => {
  it('with no cover, walks around the pillar to find the player hiding behind it, and never through it', async () => {
    const level = buildGreybox();
    const navigation = await Navigation.create(level.navigationGeometry);
    const player = { position: new Vector3(0, 0, 1.5), eyeHeightNowM: 1.6, eyes: new Vector3(0, 1.6, 1.5) }; // just south of the pillar
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, new CoverPoints([], level.collision), player, () => {});
    const enemy = new StandInEnemy({ xM: 0, zM: -2, yawRad: Math.PI }, world, () => 0.99); // just north of it
    const pillar = greyboxRoom[6];
    expect(world.canSeePlayer(enemy)).toBe(false); // the pillar hides him
    enemy.hit('body', 1);
    for (let i = 0; i < 4 / dtSec && enemy.state !== 'shoot'; i++) {
      enemy.update(dtSec, player.position);
      const inside = Math.abs(enemy.xM - pillar.xM) < pillar.widthM / 2 + 0.2 && Math.abs(enemy.zM - pillar.zM) < pillar.depthM / 2 + 0.2;
      expect(inside, `inside the pillar at ${enemy.xM}, ${enemy.zM}`).toBe(false);
    }
    expect(enemy.state).toBe('shoot'); // it got round far enough to see him
    expect(Math.abs(enemy.xM)).toBeGreaterThan(0.3); // by stepping to the side
  });
});

describe('the stand-in in the real test room (4.3)', () => {
  it('goes to a cover spot that hides it from the player, and holds there unseen', async () => {
    const level = buildGreybox();
    const navigation = await Navigation.create(level.navigationGeometry);
    const cover = new CoverPoints(greyboxCover, level.collision);
    const player = { position: new Vector3(0, 0, 4.5), eyeHeightNowM: 1.6, eyes: new Vector3(0, 1.6, 4.5) }; // the start spot
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, player, () => {});
    const enemy = new StandInEnemy({ xM: 1.5, zM: -5, yawRad: Math.PI }, world, () => 0.99); // its real spawn
    enemy.hit('body', 1);
    for (let i = 0; i < 10 / dtSec && enemy.state !== 'cover'; i++) enemy.update(dtSec, player.position);
    expect(enemy.state).toBe('cover');
    const spot = enemy.cover!;
    expect(cover.hides(spot, player.eyes)).toBe(true);
    expect(cover.claimedBy(spot)).toBe(enemy);
    expect(enemy.crouched).toBe(spot.height === 'low');
    expect(world.canSeePlayer(enemy)).toBe(false); // hidden both ways
    const fromPlayerM = Math.hypot(spot.xM - 0, spot.zM - 4.5);
    expect(fromPlayerM).toBeGreaterThanOrEqual(5);
    expect(fromPlayerM).toBeLessThanOrEqual(12);
  });
});
