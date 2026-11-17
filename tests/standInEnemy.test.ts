import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { standInConfig } from '../src/config/standInEnemy';
import { squadConfig, squadConfigDefaults } from '../src/config/squad';
import { noiseConfig } from '../src/config/noise';
import { roleConfig, roles, type Role } from '../src/config/roles';
import { aggressionConfig, aggressionSetting } from '../src/config/aggression';
import { SquadCoordinator } from '../src/squad/squadCoordinator';
import { EventBus } from '../src/core/events';
import { StandInEnemy, type StandInHooks, type StandInShot, type ThrowPlan } from '../src/enemies/standInEnemy';
import { describeFlankRejects, StandInWorld, type FlankRejects } from '../src/enemies/standInWorld';
import type { RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { greyboxCover } from '../src/data/greyboxCover';
import { greyboxStandIns } from '../src/data/greyboxEnemies';
import { CoverPoints, type CoverPoint } from '../src/level/cover';
import { dummyConfig } from '../src/config/dummy';
import { exposureConfig } from '../src/config/exposure';
import { grenadeConfig } from '../src/config/grenade';
import { enemyGunConfig, gunOfRole } from '../src/config/enemyGuns';
import { enemyGrenadeConfig } from '../src/config/enemyGrenades';
import type { Noise } from '../src/stealth/noise';
import type { WeaponEvents } from '../src/weapons/events';

const dtSec = 1 / 60;
/**
 * How far a stand-in gets in `seconds` from standing, speeding up at `accelMps2` to `speedMps` and holding it (4.15),
 * for a long, straight walk (no corner or end to slow for).
 */
const fromStandingM = (speedMps: number, accelMps2: number, seconds: number): number => {
  const upSec = speedMps / accelMps2;
  return seconds <= upSec ? 0.5 * accelMps2 * seconds * seconds : 0.5 * accelMps2 * upSec * upSec + speedMps * (seconds - upSec);
};
const spawn = { xM: 0, zM: 0, yawRad: 0 }; // faces north (-z)
/** The hit chance the fake senses report (in the game it comes from Rook's exposure meter). */
const fakeHitChance = 0.3;

/** A stand-in with fake senses. `roll` is what its random number gives: below the hit chance hits, above it misses. */
function setup(roll = 0.99, squad = new SquadCoordinator(), role: Role = 'trooper') {
  /**
   * `route` (if set) replaces the straight line the fake navigation gives: the points after the start. `cover` is what
   * the fake cover service offers (none by default, so it behaves as in 4.1), and `coverHides` whether that spot still hides it.
   */
  const world = {
    sees: true,
    clockSec: 0,
    route: null as Vector3[] | null,
    cover: null as CoverPoint | null,
    coverHides: true,
    releases: 0,
    /** Rook can be seen once the stand-in is fully out of its cover (a peek), even while `sees` is false. */
    seenWhenOut: false,
    /** Which peek positions see Rook (for choosing a side); by default the same as `sees`. */
    seesFrom: null as ((eyes: Vector3) => boolean) | null,
    tells: [] as number[],
    /** A live grenade (or none), whether it can be seen, and where planFlee sends it. */
    grenade: null as Vector3 | null,
    grenadeVisible: true,
    fleeTo: new Vector3(),
    fleeCover: null as CoverPoint | null,
    spotted: 0,
    /** No route can be found. */
    routeFails: false,
    /** An invisible wall it cannot walk north past (pushOut holds its feet at this z), or none. */
    wallAtZ: null as number | null,
    /** The hit chance a round gets (from the exposure meter in the game), and whether Rook can see the stand-in. */
    hitChance: fakeHitChance,
    rookSees: true,
    /** Spots claimed for a flank, and how many times it said its flank was over. */
    claimed: [] as CoverPoint[],
    flankOvers: 0,
    /** Whether the squad wants it to keep suppressing, and how many times it said it stopped, or its advance ended. */
    keepSuppressing: true,
    suppressOvers: 0,
    advanceOvers: 0,
    /** Whether a wall is between any noise and its ears. */
    wallBetween: false,
    /** Which peeks' guns can reach Rook's cover (way, side); all by default. And whether its own cover blocks its gun. */
    coverShotFrom: null as ((way: number, side: number) => boolean) | null,
    muzzleClear: true,
    /** Whether a squadmate stands in its line of fire (4.16), and how many reloads it started and finished. */
    friendInLine: false,
    reloadStarts: 0,
    reloadDones: 0,
    /** Holding a push (4.17): whether the squad's covering fire is live, the spot a held push would stop at, and the holds called. */
    coverLive: true,
    holdSpot: null as CoverPoint | null,
    pushHelds: 0,
    /** Where the nearest hiding cover is after a flinch on the move (none by default). */
    nearestCover: null as CoverPoint | null,
    /** Grenade throws (4.12): whether a throw is still on at the release, the throws made, and each throw's end (thrown or not). */
    throwStillOn: true,
    thrown: [] as ThrowPlan[],
    throwOvers: [] as boolean[],
  };
  const shots: { atSec: number; hits: boolean; shot: StandInShot }[] = [];
  const hooks: StandInHooks = {
    canSeePlayer: (e) => world.sees || (world.seenWhenOut && e.peekOut >= 1),
    pushOut: (feet) => {
      if (world.wallAtZ !== null) feet.z = Math.max(feet.z, world.wallAtZ);
    },
    fire: (_enemy, shot) => shots.push({ atSec: world.clockSec, hits: shot === 'hit', shot }),
    seesPlayerFrom: (eyes) => (world.seesFrom ? world.seesFrom(eyes) : world.sees),
    peekTell: () => world.tells.push(world.clockSec),
    spotGrenade: (e, radiusM, out) => {
      const g = world.grenade;
      if (!g || !world.grenadeVisible || Math.hypot(g.x - e.xM, g.z - e.zM) > radiusM) return false;
      out.copy(g);
      return true;
    },
    grenadeNear: (point, radiusM) => world.grenade !== null && Math.hypot(world.grenade.x - point.x, world.grenade.z - point.z) <= radiusM,
    planFlee: (_e, _g, _safe, out) => {
      out.copy(world.fleeTo);
      return world.fleeCover;
    },
    grenadeSpotted: () => world.spotted++,
    findPath: (from, to, out) => {
      out.length = 0;
      if (world.routeFails) return false;
      out.push(from.clone(), ...(world.route ?? [to]).map((p) => p.clone()));
      return true;
    },
    pickCover: () => world.cover,
    coverHides: () => world.coverHides,
    releaseCover: () => world.releases++,
    hitChance: () => world.hitChance,
    rookSees: () => world.rookSees,
    requestSlot: (e) => squad.requestSlot(e),
    releaseSlot: (e) => squad.releaseSlot(e),
    mayHit: (e) => squad.mayHit(e),
    hitLanded: (e) => squad.hitLanded(e),
    claimCover: (_e, point) => world.claimed.push(point),
    flankOver: (e) => {
      world.flankOvers++;
      squad.flankOver(e);
    },
    disorganised: () => squad.disorganised,
    suppressionAllowed: () => squad.suppressionAllowed,
    downed: (e) => {
      if (e.role === 'leader') squad.leaderDown();
    },
    keepSuppressing: () => world.keepSuppressing,
    suppressOver: () => world.suppressOvers++,
    advanceOver: () => world.advanceOvers++,
    noiseBlocked: () => world.wallBetween,
    coverShotClear: (_e, _point, way, side) => (world.coverShotFrom ? world.coverShotFrom(way, side) : true),
    muzzleClear: () => world.muzzleClear,
    friendInLine: () => world.friendInLine,
    reloadStarted: () => world.reloadStarts++,
    reloadDone: () => world.reloadDones++,
    coverLive: () => world.coverLive,
    pickHoldSpot: () => world.holdSpot,
    pushHeld: () => world.pushHelds++,
    hunting: () => squad.hunting,
    huntMoveOver: (e) => squad.huntMoveOver(e),
    huntHoldScale: (e) => squad.huntHoldScale(e),
    pickNearestCover: () => world.nearestCover,
    throwStillOn: () => world.throwStillOn,
    throwGrenade: (_e, plan) => world.thrown.push(plan),
    throwOver: (e, thrown) => {
      world.throwOvers.push(thrown);
      squad.grenadeOver(e, thrown);
    },
  };
  const enemy = new StandInEnemy({ ...spawn, role }, hooks, () => roll);
  /** Runs this stand-in alone (its squad's clock too). */
  const run = (player: Vector3, seconds: number) => {
    const steps = Math.round(seconds / dtSec);
    for (let i = 0; i < steps; i++) {
      world.clockSec += dtSec;
      squad.update(dtSec);
      enemy.update(dtSec, player);
    }
  };
  return { enemy, world, shots, run, squad };
}

const noiseAt = (position: Vector3, radiusM: number): Noise => ({ kind: 'footstep', position, radiusM });

/** Rook for the real world: standing at (x, z), looking north; everything counts as on his screen. */
const rookAt = (xM: number, zM: number, exposure = 0) => ({
  position: new Vector3(xM, 0, zM),
  eyeHeightNowM: 1.6,
  eyes: new Vector3(xM, 1.6, zM),
  forward: new Vector3(0, 0, -1),
  inView: () => true,
  exposure,
  movingFast: false,
});

describe('StandInEnemy waking up', () => {
  it('stays idle, still and silent until something wakes it', () => {
    const { enemy, shots, run } = setup();
    run(new Vector3(0, 0, -5), 2);
    expect(enemy.state).toBe('idle');
    expect(enemy.feet.toArray()).toEqual([0, 0, 0]);
    expect(shots).toHaveLength(0);
  });

  it('through a wall, a noise carries only part of its range (4.10)', () => {
    const { enemy, world } = setup();
    world.wallBetween = true;
    const at = new Vector3(0, standInConfig.eyeHeightM, -5);
    expect(enemy.canHear(noiseAt(at, 6))).toBe(false); // 5 m away: too far through the wall
    expect(enemy.canHear(noiseAt(at, 5 / noiseConfig.wallMuffleShare + 0.5))).toBe(true);
    world.wallBetween = false;
    expect(enemy.canHear(noiseAt(at, 6))).toBe(true);
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
    expect(enemy.health.current).toBe(roleConfig.trooper.healthPoints - 15);
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

describe('StandInEnemy first contact and hit chance (4.5)', () => {
  it('before Rook has seen it, its first burst always misses; after that warning, rounds can hit', () => {
    const { enemy, world, shots, run } = setup(0); // every roll would hit
    world.rookSees = false;
    world.hitChance = 1;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 3);
    const rounds = roleConfig.trooper.burstRounds;
    expect(shots.length).toBeGreaterThan(rounds);
    expect(shots.slice(0, rounds).every((s) => !s.hits)).toBe(true);
    expect(shots[rounds].hits).toBe(true);
  });

  it('once Rook has seen it, there is no warning burst; a respawn brings the warning back', () => {
    const { enemy, world, shots, run } = setup(0);
    world.hitChance = 1;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 1);
    expect(shots[0].hits).toBe(true);
    world.rookSees = false;
    enemy.reset();
    shots.length = 0;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 1);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.slice(0, roleConfig.trooper.burstRounds).every((s) => !s.hits)).toBe(true);
  });

  it('takes its hit chance from its senses (the exposure meter): at 0 it never hits', () => {
    const { enemy, world, shots, run } = setup(0);
    world.hitChance = 0;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 4);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => !s.hits)).toBe(true);
  });
});

describe('StandInEnemy in a squad (4.6)', () => {
  const rook = new Vector3(0, 0, -5);
  /** Takes every firing slot for other squad members. */
  const fill = (squad: SquadCoordinator) => {
    const others = Array.from({ length: squadConfig.firingSlots }, () => ({}));
    for (const other of others) expect(squad.requestSlot(other)).toBe(true);
    return others;
  };

  it('with every firing slot taken it keeps aiming but holds fire, and fires once one is free', () => {
    const { enemy, shots, run, squad } = setup();
    const others = fill(squad);
    enemy.hit('body', 1);
    run(rook, 2);
    expect(enemy.state).toBe('shoot');
    expect(shots).toHaveLength(0);
    squad.releaseSlot(others[0]);
    run(rook, dtSec * 2);
    expect(shots).toHaveLength(1);
    expect(squad.holdsSlot(enemy)).toBe(true); // in the middle of its burst
  });

  it('gives its slot back when the burst ends, and when it is frozen or falls mid-burst', () => {
    const ended = setup();
    ended.enemy.hit('body', 1);
    ended.run(rook, standInConfig.reactionSec + roleConfig.trooper.burstRounds * standInConfig.roundIntervalSec + 0.1);
    expect(ended.shots).toHaveLength(roleConfig.trooper.burstRounds);
    expect(ended.squad.slotsHeld).toBe(0); // between bursts

    for (const stop of ['freeze', 'fall'] as const) {
      const { enemy, shots, run, squad } = setup();
      enemy.hit('body', 1);
      for (let i = 0; i < 5 / dtSec && shots.length === 0; i++) run(rook, dtSec);
      expect(squad.holdsSlot(enemy)).toBe(true);
      if (stop === 'freeze') enemy.frozen = true;
      else enemy.kill();
      run(rook, dtSec);
      expect(squad.slotsHeld, stop).toBe(0);
    }
  });

  it('a peek with no free slot stays in cover and asks again; it comes out once a slot is free', () => {
    const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI };
    const far = new Vector3(0, 0, 10);
    const { enemy, world, run, squad } = setup();
    world.sees = false;
    world.cover = spot;
    enemy.hit('body', 1);
    run(far, 1.5);
    expect(enemy.state).toBe('cover');
    world.tells.length = 0;
    const others = fill(squad);
    run(far, standInConfig.peekHoldMaxSec * standInConfig.woundedHoldScale + 1);
    expect(world.tells).toHaveLength(0);
    expect(enemy.peekOut).toBe(0);
    squad.releaseSlot(others[0]);
    run(far, squadConfig.slotRetrySec + 0.1);
    expect(world.tells).toHaveLength(1);
    expect(squad.holdsSlot(enemy)).toBe(true);
  });

  it('four stand-ins in the open: never more than two hold slots, every one gets to fire, and no two enemies hit Rook within 0.5 s', () => {
    const squad = new SquadCoordinator();
    const members = Array.from({ length: 4 }, () => setup(0, squad)); // every roll would hit
    for (const member of members) member.enemy.hit('body', 1);
    let mostHeld = 0;
    for (let i = 0; i < 10 / dtSec; i++) {
      squad.update(dtSec);
      for (const member of members) {
        member.world.clockSec += dtSec;
        member.enemy.update(dtSec, rook);
      }
      mostHeld = Math.max(mostHeld, squad.slotsHeld);
    }
    expect(mostHeld).toBe(squadConfig.firingSlots);
    for (const member of members) expect(member.shots.length).toBeGreaterThan(0);
    const hits = members.flatMap((m, who) => m.shots.filter((s) => s.hits).map((s) => ({ atSec: s.atSec, who }))).sort((a, b) => a.atSec - b.atSec);
    expect(hits.length).toBeGreaterThan(3);
    for (let i = 1; i < hits.length; i++) {
      if (hits[i].who !== hits[i - 1].who) expect(hits[i].atSec - hits[i - 1].atSec).toBeGreaterThanOrEqual(squadConfig.hitGapSec - 1e-9); // decision 270
    }
  });
});

describe('StandInEnemy roles (4.8)', () => {
  it('each role spawns with its own health, walks at its own speed and fires its own burst length', () => {
    for (const role of roles) {
      const values = roleConfig[role];
      const walker = setup(0.99, new SquadCoordinator(), role);
      expect(walker.enemy.role).toBe(role);
      expect(walker.enemy.health.current, role).toBe(values.healthPoints);
      walker.world.sees = false;
      walker.enemy.hit('body', 1);
      walker.run(new Vector3(0, 0, -30), 1);
      expect(-walker.enemy.feet.z, role).toBeCloseTo(fromStandingM(values.walkSpeedMps, values.accelMps2, 1), 1); // speeding up (4.15)
      expect(walker.enemy.speedMps, role).toBeCloseTo(values.walkSpeedMps, 5); // then at its own speed

      const shooter = setup(0.99, new SquadCoordinator(), role);
      shooter.enemy.hit('body', 1);
      shooter.run(new Vector3(0, 0, -5), standInConfig.reactionSec + values.burstRounds * standInConfig.roundIntervalSec + 0.3);
      expect(shooter.shots.length, role).toBe(values.burstRounds); // one whole burst, then the pause
    }
  });

  it('a heavy never flanks; a flanker can', () => {
    for (const [role, can] of [['heavy', false], ['flanker', true]] as const) {
      const { enemy, world, run } = setup(0.99, new SquadCoordinator(), role);
      world.sees = false;
      enemy.hit('body', 1);
      run(new Vector3(0, 0, 20), dtSec);
      expect(enemy.canFlank, role).toBe(can);
    }
  });

  it('the squad leader going down disorganises the squad; anyone else does not', () => {
    const trooper = setup(0.99, new SquadCoordinator(), 'trooper');
    trooper.enemy.kill();
    expect(trooper.squad.disorganised).toBe(false);
    const leader = setup(0.99, new SquadCoordinator(), 'leader');
    leader.enemy.kill();
    expect(leader.squad.disorganised).toBe(true);
  });

  it('with the squad disorganised it holds longer between peeks', () => {
    const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI };
    const far = new Vector3(0, 0, 10);
    const roll = 0.99; // the longest hold
    const holdSec = standInConfig.peekHoldMinSec + roll * (standInConfig.peekHoldMaxSec - standInConfig.peekHoldMinSec);
    const { enemy, world, run, squad } = setup(roll);
    world.sees = false;
    world.cover = spot;
    squad.leaderDown();
    enemy.hit('body', 1);
    run(far, 1.5);
    expect(enemy.state).toBe('cover');
    world.tells.length = 0;
    run(far, holdSec); // a normal hold would be over by now
    expect(world.tells).toHaveLength(0);
  });
});

describe('StandInEnemy flanking (4.7)', () => {
  const far = new Vector3(0, 0, 20); // beyond its stop range: it walks
  const flankSpot: CoverPoint = { xM: 7, zM: 0, height: 'low', facingYawRad: Math.PI / 2, lean: 'both' }; // 7 m east
  /** An awake stand-in walking toward a far Rook, ready to be sent. */
  const walking = (squad = new SquadCoordinator()) => {
    const s = setup(0.99, squad);
    s.world.rookSees = false;
    s.enemy.hit('body', 1);
    s.run(far, dtSec);
    return s;
  };

  it('can be sent only while awake, walking or in cover, and not wounded or frozen', () => {
    const { enemy } = walking();
    expect(enemy.canFlank).toBe(true);
    enemy.frozen = true;
    expect(enemy.canFlank).toBe(false);
    enemy.frozen = false;
    enemy.hit('body', roleConfig.trooper.healthPoints * (1 - standInConfig.woundedHealthShare) + 1);
    expect(enemy.wounded).toBe(true);
    expect(enemy.canFlank).toBe(false);
    expect(setup().enemy.canFlank).toBe(false); // idle
  });

  it('walks to its flank spot at the flank speed without firing, then holds there; the squad hears the flank is over', () => {
    const { enemy, world, shots, run } = walking();
    world.sees = true; // it could see Rook, but a flanker does not fire on the way
    const start = enemy.feet.clone();
    enemy.beginFlank(flankSpot);
    expect(world.claimed).toEqual([flankSpot]);
    expect(enemy.cover).toBe(flankSpot);
    run(far, 1);
    expect(enemy.state).toBe('flank');
    const flankMps = Math.max(roleConfig.trooper.flankSpeedMps, roleConfig.trooper.runSpeedMps); // no slower than a run (decision 246)
    expect(enemy.feet.distanceTo(start)).toBeCloseTo(fromStandingM(flankMps, roleConfig.trooper.accelMps2, 1), 0); // speeding up from standing (4.15)
    expect(shots).toHaveLength(0);
    expect(world.flankOvers).toBe(0);
    run(far, 2);
    expect(enemy.state).toBe('cover');
    expect(enemy.feet.x).toBeGreaterThan(7 - standInConfig.coverArriveM - 1e-6); // there, within the arrival distance
    expect(world.flankOvers).toBe(1);
  });

  it('seen by Rook on the way for the spotted time, it calls the flank off and looks for cover', () => {
    const unseen = walking();
    unseen.enemy.beginFlank(flankSpot);
    unseen.run(far, squadConfig.spottedSec + 0.3);
    expect(unseen.enemy.state).toBe('flank');

    const { enemy, world, run } = walking();
    enemy.beginFlank(flankSpot);
    world.rookSees = true;
    const releasesBefore = world.releases;
    run(far, squadConfig.spottedSec + 1 / standInConfig.sightChecksPerSec + 0.05);
    expect(enemy.state).not.toBe('flank');
    expect(world.flankOvers).toBe(1);
    expect(world.releases).toBeGreaterThan(releasesBefore); // it let the flank spot go
  });

  /** A stand-in that has just arrived at its flank spot: hidden there, but it sees Rook once fully out of a peek. */
  const arrived = () => {
    const s = walking();
    s.world.sees = false;
    s.world.seenWhenOut = true;
    s.enemy.beginFlank(flankSpot);
    for (let i = 0; i < 5 / dtSec && s.enemy.state !== 'cover'; i++) s.run(far, dtSec);
    expect(s.enemy.state).toBe('cover');
    return s;
  };
  const outSec = standInConfig.tellSec + standInConfig.peekOutSec;

  it('the flank attack: on arrival it peeks at once (with the tell) and stays out firing burst after burst', () => {
    const { enemy, world, shots, run } = arrived();
    run(far, dtSec * 2);
    expect(world.tells).toHaveLength(1); // no hold first
    run(far, outSec + 3);
    expect(enemy.peekOut).toBe(1); // still out
    expect(shots.length).toBeGreaterThanOrEqual(roleConfig.trooper.burstRounds * 2);
    expect(shots.every((s) => s.shot !== 'cover')).toBe(true);
  });

  it('the flank attack ends at once when Rook hurts it, even mid-burst', () => {
    const { enemy, shots, run } = arrived();
    run(far, outSec + 0.05); // out, its first burst under way
    expect(enemy.peekOut).toBe(1);
    enemy.hit('body', 1);
    const fired = shots.length;
    run(far, standInConfig.peekBackSec + 0.05);
    expect(enemy.peekOut).toBe(0);
    expect(shots.length).toBe(fired);
  });

  it('the flank attack ends when it has not seen Rook for a moment, or when its time is up', () => {
    const lost = arrived();
    lost.run(far, outSec + 1);
    lost.world.seenWhenOut = false; // he hid
    lost.run(far, squadConfig.flankPressLostSightSec + 1 / standInConfig.sightChecksPerSec + standInConfig.peekBackSec + 0.1);
    expect(lost.enemy.peekOut).toBe(0);

    const timed = arrived();
    timed.run(far, outSec + squadConfig.flankPressMaxSec + standInConfig.peekBackSec + 0.1);
    expect(timed.enemy.peekOut).toBe(0);
  });

  it('in a flank attack each burst needs a firing slot: with none free it stays out aiming but holds fire', () => {
    const { enemy, shots, run, squad } = arrived();
    run(far, outSec + roleConfig.trooper.burstRounds * standInConfig.roundIntervalSec + 0.05); // the first burst done
    const fired = shots.length;
    expect(squad.holdsSlot(enemy)).toBe(false); // given back between bursts
    for (let i = 0; i < squadConfig.firingSlots; i++) squad.requestSlot({});
    run(far, standInConfig.burstPauseSec + 0.5);
    expect(shots.length).toBe(fired);
    expect(enemy.peekOut).toBe(1);
  });

  it('a grenade it sees beats the flank, and the squad hears the flank is over', () => {
    const { enemy, world, run } = walking();
    enemy.beginFlank(flankSpot);
    world.grenade = enemy.feet.clone();
    run(far, standInConfig.grenadeReactionSec + 0.3);
    expect(enemy.state).toBe('flee');
    expect(world.flankOvers).toBe(1);
  });

  it('in a squad: after Rook holds his spot, one is sent; no other flank until it is over and the wait has passed', () => {
    const squad = new SquadCoordinator();
    const members = Array.from({ length: 4 }, () => walking(squad));
    const rookFeet = { x: 0, z: 20 };
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dtSec); i++) {
        squad.update(dtSec, rookFeet);
        if (squad.flankDue) {
          // The fake plans: the third member has the cheapest spot.
          const job = squad.assignFlank(members.map((m) => m.enemy), (e) => ({ point: flankSpot, cost: e === members[2].enemy ? 1 : 5 }));
          job?.member.beginFlank(job.plan.point);
        }
        for (const m of members) {
          m.world.clockSec += dtSec;
          m.enemy.update(dtSec, far);
        }
      }
    };
    step(aggressionConfig.assertive.holdBeforeFlankSec - 0.5);
    expect(members.some((m) => m.enemy.state === 'flank')).toBe(false);
    step(1);
    expect(members[2].enemy.state).toBe('flank');
    expect(members.filter((m) => m.enemy.state === 'flank')).toHaveLength(1);
    step(4); // it arrives
    expect(members[2].enemy.state).toBe('cover');
    expect(squad.flanker).toBeNull();
    step(aggressionConfig.assertive.flankWaitSec - 1.5);
    const flanksSent = () => members.reduce((sum, m) => sum + m.world.claimed.length, 0);
    expect(flanksSent()).toBe(1); // nobody sent during the wait
    step(2);
    expect(flanksSent()).toBe(2); // the next flank, after the wait (the cheapest plan again)
  });
});

describe('StandInEnemy suppressing and advancing (4.9)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI, lean: 'both' };
  const far = new Vector3(0, 0, 10);
  const outSec = standInConfig.tellSec + standInConfig.peekOutSec;
  /** A stand-in holding cover, Rook hidden from it (even when it peeks), with fresh knowledge of where he is. */
  const holding = () => {
    const s = setup();
    s.world.sees = false;
    s.world.cover = spot;
    s.enemy.hit('body', 1);
    s.run(far, 1.5);
    expect(s.enemy.state).toBe('cover');
    s.world.tells.length = 0;
    s.shots.length = 0;
    return s;
  };

  it('can suppress and advance from cover; not while wounded', () => {
    const { enemy } = holding();
    expect(enemy.canSuppress).toBe(true);
    expect(enemy.canAdvance).toBe(true);
    enemy.hit('body', roleConfig.trooper.healthPoints * (1 - standInConfig.woundedHealthShare) + 1);
    expect(enemy.canSuppress).toBe(false);
    expect(enemy.canAdvance).toBe(false);
  });

  it('suppressing: out at once, long bursts of suppressing fire, until the squad says the move is over', () => {
    const { enemy, world, shots, run } = holding();
    enemy.beginSuppress();
    expect(enemy.isSuppressing).toBe(true);
    run(far, dtSec * 2);
    expect(world.tells).toHaveLength(1); // no hold first
    run(far, outSec + 1.5);
    expect(enemy.peekOut).toBe(1);
    expect(shots.length).toBeGreaterThanOrEqual(squadConfig.suppressBurstRounds);
    expect(shots.every((s) => s.shot === 'suppress')).toBe(true);
    world.keepSuppressing = false;
    run(far, standInConfig.peekBackSec + 0.1);
    expect(enemy.peekOut).toBe(0);
    expect(enemy.isSuppressing).toBe(false);
    expect(world.suppressOvers).toBe(1);
  });

  it('suppressing ends when Rook hurts it, or after its time', () => {
    const hurt = holding();
    hurt.enemy.beginSuppress();
    hurt.run(far, outSec + 0.3);
    hurt.enemy.hit('body', 1);
    hurt.run(far, standInConfig.peekBackSec + 0.1);
    expect(hurt.enemy.isSuppressing).toBe(false);
    expect(hurt.enemy.peekOut).toBe(0);

    const timed = holding();
    timed.enemy.beginSuppress();
    timed.run(far, outSec + squadConfig.suppressMaxSec + standInConfig.peekBackSec + 0.2);
    expect(timed.enemy.isSuppressing).toBe(false);
  });

  it('suppressing and seeing Rook, it fires aimed rounds at him instead', () => {
    const { enemy, world, shots, run } = holding();
    world.seenWhenOut = true;
    enemy.beginSuppress();
    run(far, outSec + 0.5);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.shot !== 'suppress')).toBe(true);
  });

  it('advancing: runs to its spot (decision 246), is not turned back when seen, then holds as usual', () => {
    const { enemy, world, shots, run } = holding();
    world.rookSees = true;
    const next: CoverPoint = { xM: 5, zM: -3, height: 'low', facingYawRad: Math.PI };
    const start = enemy.feet.clone();
    enemy.beginAdvance(next);
    run(far, 1);
    expect(enemy.state).toBe('advance');
    expect(enemy.feet.distanceTo(start)).toBeCloseTo(fromStandingM(roleConfig.trooper.runSpeedMps, roleConfig.trooper.accelMps2, 1), 0); // a run, from standing (4.15)
    run(far, 2);
    expect(enemy.state).toBe('cover');
    expect(world.advanceOvers).toBe(1);
    expect(shots).toHaveLength(0);
    world.tells.length = 0;
    run(far, standInConfig.peekHoldMinSec - 0.5);
    expect(world.tells).toHaveLength(0); // no attack on arrival: it holds first
  });

  it("Rook's near miss while it is out sends it back in, and its next hold is longer", () => {
    const { enemy, world, run } = holding();
    enemy.beginSuppress(); // out at once
    run(far, outSec);
    world.keepSuppressing = false; // so it does not come straight back out
    enemy.pinDown();
    run(far, standInConfig.peekBackSec + 0.05);
    expect(enemy.peekOut).toBe(0);
    world.tells.length = 0;
    const roll = 0.99;
    const holdSec = standInConfig.peekHoldMinSec + roll * (standInConfig.peekHoldMaxSec - standInConfig.peekHoldMinSec);
    run(far, holdSec + 0.1);
    expect(world.tells).toHaveLength(0); // still holding: the hold is longer
    run(far, holdSec * (squadConfig.pinnedHoldScale - 1));
    expect(world.tells).toHaveLength(1);
  });
});

describe('StandInEnemy repositioning and the heavy on the move (decision 237)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI, lean: 'both' };
  const next: CoverPoint = { xM: 5, zM: -3, height: 'low', facingYawRad: Math.PI };
  const far = new Vector3(0, 0, 10);
  const peekSec = standInConfig.tellSec + standInConfig.peekOutSec + 0.6 + standInConfig.peekBackSec;
  const holdMaxSec = standInConfig.peekHoldMaxSec;
  /** A stand-in of `role` holding `spot`, every random number `roll`. */
  const holding = (roll = 0.99, role: Role = 'trooper') => {
    const s = setup(roll, new SquadCoordinator(), role);
    s.world.sees = false;
    s.world.cover = spot;
    s.enemy.hit('body', 1);
    s.run(far, 2.5); // the heavy walks slower
    expect(s.enemy.state).toBe('cover');
    return s;
  };

  it('two blind peeks in a row and it wants to move on', () => {
    const { enemy, run } = holding(); // it never sees Rook, even out of cover
    run(far, holdMaxSec + peekSec);
    expect(enemy.wantsToReposition).toBe(false); // one blind peek
    run(far, holdMaxSec + peekSec);
    expect(enemy.wantsToReposition).toBe(true);
    enemy.repositionDeclined();
    expect(enemy.wantsToReposition).toBe(false);
  });

  it('after enough peeks from one spot it wants to move on, even when it sees him', () => {
    const { enemy, world, run } = holding(0.99); // 0.99: the most peeks, repositionPeeksMax
    world.seenWhenOut = true;
    for (let i = 0; i < squadConfig.repositionPeeksMax - 1; i++) run(far, holdMaxSec + peekSec);
    expect(enemy.wantsToReposition).toBe(false);
    run(far, holdMaxSec + peekSec);
    expect(enemy.wantsToReposition).toBe(true);
  });

  it('pinned or hurt while peeking, it wants to move on', () => {
    const pinned = holding();
    pinned.enemy.beginSuppress(); // out at once
    pinned.world.keepSuppressing = false;
    pinned.run(far, standInConfig.tellSec + standInConfig.peekOutSec);
    pinned.enemy.pinDown();
    pinned.run(far, standInConfig.peekBackSec + 0.1);
    expect(pinned.enemy.wantsToReposition).toBe(true);
  });

  it('a reposition moves like an advance and tells the squad when it is over', () => {
    const { enemy, world, run } = holding();
    enemy.beginReposition(next);
    run(far, dtSec);
    expect(enemy.state).toBe('advance');
    run(far, 3);
    expect(enemy.state).toBe('cover');
    expect(enemy.cover).toBe(next);
    expect(world.advanceOvers).toBe(1);
  });

  it('the heavy fires on the move: suppressing bursts when it does not see Rook, aimed ones when it does', () => {
    const blind = holding(0.99, 'heavy');
    blind.shots.length = 0;
    blind.enemy.beginAdvance(next);
    blind.run(far, 2);
    expect(blind.enemy.state).toBe('advance');
    expect(blind.shots.length).toBeGreaterThan(0);
    expect(blind.shots.every((s) => s.shot === 'suppress')).toBe(true);

    const seeing = holding(0.99, 'heavy');
    seeing.world.sees = true;
    seeing.run(far, 1 / standInConfig.sightChecksPerSec + 0.05); // it notices at its next sight check
    seeing.shots.length = 0;
    seeing.enemy.beginAdvance(next);
    seeing.run(far, 1.5);
    expect(seeing.shots.length).toBeGreaterThan(0);
    expect(seeing.shots.every((s) => s.shot === 'hit' || s.shot === 'miss')).toBe(true);

    const trooper = holding(0.99, 'trooper');
    trooper.shots.length = 0;
    trooper.enemy.beginAdvance(next);
    trooper.run(far, 1.5);
    expect(trooper.shots).toHaveLength(0); // the others do not fire while they move
  });

  it('at Cautious the heavy on the move fires no suppressing rounds (4.11)', () => {
    aggressionSetting.current = 'cautious';
    try {
      const blind = holding(0.99, 'heavy');
      blind.shots.length = 0;
      blind.enemy.beginAdvance(next);
      blind.run(far, 2);
      expect(blind.shots).toHaveLength(0);
    } finally {
      aggressionSetting.current = 'assertive';
    }
  });
});

describe('StandInEnemy: no walk in the open, no rounds into its own cover (decision 239)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI, lean: 'both' };
  const next: CoverPoint = { xM: 5, zM: -3, height: 'low', facingYawRad: Math.PI };
  const far = new Vector3(0, 0, 10);
  const outSec = standInConfig.tellSec + standInConfig.peekOutSec;
  /** A stand-in holding `spot` (roll 0.99: a random pick takes the last choice), Rook hidden from it. */
  const holding = () => {
    const s = setup();
    s.world.sees = false;
    s.world.cover = spot;
    s.enemy.hit('body', 1);
    s.run(far, 1.5);
    expect(s.enemy.state).toBe('cover');
    s.shots.length = 0;
    return s;
  };

  it('an advance whose spot stops hiding it is dropped, and it takes cover from where it is', () => {
    const { enemy, world, run } = holding();
    enemy.beginAdvance(next);
    run(far, 0.2);
    expect(enemy.state).toBe('advance');
    world.coverHides = false; // Rook moved
    run(far, standInConfig.coverCheckIntervalSec + 0.05);
    expect(enemy.state).not.toBe('advance');
    expect(world.advanceOvers).toBe(1);
  });

  it('a suppressor comes out where its gun reaches the edge of his cover, or pins the other edge', () => {
    const rising = holding();
    rising.world.coverShotFrom = (way) => way === 0; // only rising over the cover reaches it
    const before = rising.enemy.feet.clone();
    rising.enemy.beginSuppress();
    rising.run(far, outSec + 0.1);
    expect(rising.enemy.peekOut).toBe(1);
    expect(rising.enemy.feet.distanceTo(before)).toBeLessThan(0.01); // rose, no side step

    const other = holding();
    other.world.coverShotFrom = (way, side) => way === 1 && side === -1;
    other.enemy.beginSuppress(); // roll 0.99: it meant to pin edge 1
    other.run(far, outSec + 0.1);
    expect(other.enemy.suppressSideSign).toBe(-1);
    expect(other.enemy.feet.x).toBeLessThan(spot.xM - 0.5); // stepped out its right (west, facing south)
  });

  it('with its own cover in the way it never fires: a peek goes back in, and seeing Rook from cover it peeks instead', () => {
    const peek = holding();
    peek.world.muzzleClear = false;
    peek.enemy.beginSuppress();
    peek.run(far, outSec + 0.5);
    expect(peek.shots).toHaveLength(0);
    expect(peek.enemy.isSuppressing).toBe(false);

    const seeing = holding();
    seeing.world.muzzleClear = false;
    seeing.world.sees = true;
    seeing.world.tells.length = 0;
    seeing.run(far, standInConfig.peekHoldMaxSec + 0.5);
    expect(seeing.shots).toHaveLength(0);
    expect(seeing.world.tells.length).toBeGreaterThan(0);
  });
});

describe('StandInEnemy walking and shooting', () => {
  it('walks straight at the player at its walk speed while it cannot see him, without firing', () => {
    const { enemy, world, shots, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -20), 1);
    expect(enemy.state).toBe('approach');
    expect(enemy.feet.z).toBeCloseTo(-fromStandingM(roleConfig.trooper.walkSpeedMps, roleConfig.trooper.accelMps2, 1), 1); // speeding up (4.15)
    expect(enemy.speedMps).toBeCloseTo(roleConfig.trooper.walkSpeedMps, 5);
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
    const stepM = roleConfig.trooper.walkSpeedMps * dtSec;
    expect(Math.abs(enemy.feet.z - -3)).toBeGreaterThan(standInConfig.closestM - stepM - 1e-9);
    expect(Math.abs(enemy.feet.z - -3)).toBeLessThanOrEqual(standInConfig.closestM + 1e-9);
  });

  it('moving like a person (4.15): slows into a right-angle corner to about the corner share of its speed', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.route = [new Vector3(6, 0, 0), new Vector3(6, 0, -8)]; // 6 m east, then a right-angle turn north
    // The fake route always runs through the corner point, even once it has cut past it: plan it only once here.
    const repathSec = standInConfig.repathIntervalSec;
    standInConfig.repathIntervalSec = 100;
    enemy.hit('body', 1);
    let straightMps = 0;
    let cornerMps = Infinity;
    try {
      for (let t = 0; t < 4; t += dtSec) {
        run(new Vector3(6, 0, -8), dtSec);
        if (enemy.feet.x < 3) straightMps = Math.max(straightMps, enemy.speedMps); // on the straight
        if (Math.hypot(enemy.feet.x - 6, enemy.feet.z) < 0.5) cornerMps = Math.min(cornerMps, enemy.speedMps); // at the corner
      }
    } finally {
      standInConfig.repathIntervalSec = repathSec;
    }
    const walkMps = roleConfig.trooper.walkSpeedMps;
    expect(straightMps).toBeCloseTo(walkMps, 5); // full speed on the straight
    expect(cornerMps).toBeLessThan(walkMps * 0.75); // slowed for the corner...
    expect(cornerMps).toBeGreaterThan(walkMps * standInConfig.cornerSpeedShareRightAngle * 0.5); // ...but did not stop
  });

  it('moving like a person (4.15): a sudden reversal brakes almost to a stop before it speeds up the other way', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.route = [new Vector3(10, 0, 0)];
    enemy.hit('body', 1);
    run(new Vector3(10, 0, 0), 1); // walking east, up to speed
    expect(enemy.speedMps).toBeCloseTo(roleConfig.trooper.walkSpeedMps, 5);
    world.route = [new Vector3(-10, 0, 0)]; // the next route goes back west
    let slowestMps = Infinity;
    for (let t = 0; t < 1.5; t += dtSec) {
      run(new Vector3(-10, 0, 0), dtSec);
      slowestMps = Math.min(slowestMps, enemy.speedMps);
    }
    expect(slowestMps).toBeLessThan(roleConfig.trooper.walkSpeedMps / 2); // slowed hard to turn round (a tight curve, not a snap)
    expect(enemy.speedMps).toBeGreaterThan(1); // and then off the other way
    expect(enemy.feet.x).toBeLessThan(2.5); // and it really did turn back west
  });

  it('moving like a person (4.15): slows to a stop as it reaches its spot, without overshooting', () => {
    const { enemy, world, run } = setup();
    world.rookSees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 20), dtSec);
    const spot: CoverPoint = { xM: 6, zM: 0, height: 'low', facingYawRad: Math.PI / 2, lean: 'both' };
    enemy.beginAdvance(spot);
    let arrivedMps: number | null = null;
    let mostEastM = -Infinity;
    for (let t = 0; t < 5 && arrivedMps === null; t += dtSec) {
      run(new Vector3(0, 0, 20), dtSec);
      mostEastM = Math.max(mostEastM, enemy.feet.x);
      if (Math.hypot(enemy.feet.x - spot.xM, enemy.feet.z - spot.zM) <= standInConfig.coverArriveM) arrivedMps = enemy.speedMps;
    }
    expect(arrivedMps).not.toBeNull();
    expect(arrivedMps!).toBeLessThan(standInConfig.creepSpeedMps + roleConfig.trooper.accelMps2 * dtSec + 1e-9); // all but stopped
    expect(mostEastM).toBeLessThanOrEqual(spot.xM + 1e-9); // never past its spot
    run(new Vector3(0, 0, 20), 1);
    expect(enemy.state).toBe('cover');
    expect(enemy.speedMps).toBe(0);
  });

  it('follows its route, rounding the corner in an arc (4.15), facing the way it walks', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.route = [new Vector3(2, 0, 0), new Vector3(2, 0, -6)]; // east first, then north
    enemy.hit('body', 1);
    run(new Vector3(2, 0, -6), 0.4); // 1 m along the first leg
    expect(enemy.feet.x).toBeGreaterThan(0.5);
    expect(enemy.feet.z).toBeCloseTo(0, 5);
    expect(Math.sin(enemy.yawRad)).toBeLessThan(-0.9); // facing east (yaw -90 degrees)
    let mostEastM = -Infinity;
    for (let t = 0; t < 1.2; t += dtSec) {
      run(new Vector3(2, 0, -6), dtSec); // round the corner
      mostEastM = Math.max(mostEastM, enemy.feet.x);
    }
    expect(mostEastM).toBeLessThanOrEqual(2 + 1e-9); // it never swings out past the corner
    expect(enemy.feet.x).toBeLessThan(2); // it cut a little inside it: an arc
    expect(enemy.feet.x).toBeGreaterThan(2 - standInConfig.lookaheadMinM - 0.2); // but only a little
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
    const { reactionSec, roundIntervalSec, burstPauseSec } = standInConfig;
    const { burstRounds } = roleConfig.trooper;
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

  it('its own hits never hold back its next rounds: every round of a burst can land (decision 270)', () => {
    const { enemy, shots, run } = setup(0);
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 4);
    expect(shots.slice(0, roleConfig.trooper.burstRounds).map((s) => s.hits)).toEqual([true, true, true]);
  });

  it("keeps the hit budget between enemies: another enemy's hit holds its rounds back for the window", () => {
    const squad = new SquadCoordinator();
    const { enemy, shots, run } = setup(0, squad);
    squad.hitLanded({}); // a squadmate just hit Rook
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 4);
    const first = shots.find((s) => s.hits);
    expect(first).toBeDefined();
    expect(first!.atSec).toBeGreaterThanOrEqual(squadConfig.hitGapSec - 1e-9);
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
  it('getting up alone (decision 201, the respawn rule before 4.16): falls, lies down, then gets up at its spawn spot awake and at full health', () => {
    const together = squadConfig.respawnTogether;
    squadConfig.respawnTogether = 0;
    try {
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
      expect(enemy.health.current).toBe(roleConfig.trooper.healthPoints);
      expect(Math.abs(enemy.feet.z)).toBeLessThan(0.1); // back at the spot (it may have taken one step)
    } finally {
      squadConfig.respawnTogether = together;
    }
  });

  it('respawning together (4.16): a downed one stays down until the squad comes back, then gets up awake', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -20), 1);
    enemy.kill();
    run(new Vector3(0, 0, -20), standInConfig.fallTimeSec + standInConfig.respawnDelaySec * 2);
    expect(enemy.state).toBe('down'); // it waits for the rest of the squad
    enemy.reset(); // what the game does when the last one is down: the whole squad back at its spawns...
    enemy.getUpWithSquad(); // ...awake
    expect(enemy.awake).toBe(true);
    expect(enemy.health.current).toBe(roleConfig.trooper.healthPoints);
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
    expect(enemy.health.current).toBe(roleConfig.trooper.healthPoints);
  });
});

describe('StandInEnemy and cover (4.3)', () => {
  const lowSpot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: 0 };
  const highSpot: CoverPoint = { xM: 3, zM: 0, height: 'high', facingYawRad: Math.PI / 2 };

  it('walks to its cover spot standing, then crouches behind low cover, faces where Rook was, and holds without firing', () => {
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
    expect(Math.cos(enemy.yawRad)).toBeLessThan(-0.99); // facing where Rook was (south), not the cover's stored direction (decision 213)
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

describe('StandInEnemy remembering where Rook was (4.4 follow-up)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'high', facingYawRad: 0, lean: 'both' }; // its cover is to its north

  it('hearing a noise and seeing Rook each set where it last knew he was', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hear(noiseAt(new Vector3(9, 1.6, 2), 30));
    expect(enemy.knowsWhere).toBe(true);
    expect(enemy.lastKnown.toArray()).toEqual([9, 0, 2]);
    world.sees = true;
    run(new Vector3(-12, 0, 5), dtSec);
    expect(enemy.lastKnown.toArray()).toEqual([-12, 0, 5]);
  });

  it('holding cover, it faces where it last knew Rook was, not the cover, and keeps facing there when he moves unseen', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.cover = spot;
    enemy.hear(noiseAt(new Vector3(12, 1.6, -3), 30)); // heard due east of its spot, 12 m away
    run(new Vector3(12, 0, -3), 2.5);
    expect(enemy.state).toBe('cover');
    expect(Math.sin(enemy.yawRad)).toBeLessThan(-0.99); // facing east (yaw -90 degrees), not north at its cover
    run(new Vector3(-12, 0, 10), 1); // he slips away west, unseen
    expect(Math.sin(enemy.yawRad)).toBeLessThan(-0.99); // it still watches where he was
    expect(enemy.lastKnown.x).toBe(12);
  });

  it('forgets on a reset, and starts from where Rook is when woken by a hit', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hear(noiseAt(new Vector3(9, 1.6, 2), 30));
    enemy.reset();
    expect(enemy.knowsWhere).toBe(false);
    enemy.hit('body', 1);
    run(new Vector3(-4, 0, 6), dtSec);
    expect(enemy.lastKnown.toArray()).toEqual([-4, 0, 6]);
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
    // It notices its cover has failed at its next cover check (decision 218), then stands and fights.
    for (let i = 0; i < standInConfig.coverCheckIntervalSec / dtSec + 2 && enemy.state !== 'fight'; i++) run(rook, dtSec);
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
    expect(movedM).toBeLessThanOrEqual(roleConfig.trooper.walkSpeedMps * standInConfig.retreatSpeedShare + 1e-6);
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
    expect(shots).toHaveLength(roleConfig.trooper.burstRounds);
    run(rook, 1);
    expect(shots).toHaveLength(roleConfig.trooper.burstRounds);
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
    const roll = fakeHitChance * (1 + standInConfig.retreatHitChanceShare) / 2;
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

describe('StandInEnemy peeking from cover (4.4)', () => {
  const lowSpot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI }; // the cover is to its south, toward Rook
  const highSpot: CoverPoint = { xM: 0, zM: -3, height: 'high', facingYawRad: Math.PI, lean: 'both' };
  const rook = new Vector3(0, 0, 10); // 13 m south: beyond the stand-ground range

  /** A stand-in that has walked to `spot` and is holding there, hidden. `roll` is every random number it draws. */
  function holding(spot: CoverPoint, roll = 0.99) {
    const s = setup(roll);
    s.world.sees = false;
    s.world.cover = spot;
    s.enemy.hit('body', 1);
    s.run(rook, 1.5);
    expect(s.enemy.state).toBe('cover');
    s.world.tells.length = 0;
    s.shots.length = 0;
    s.world.clockSec = 0;
    return s;
  }
  const holdSec = (roll: number) => standInConfig.peekHoldMinSec + roll * (standInConfig.peekHoldMaxSec - standInConfig.peekHoldMinSec);
  /** Runs one update at a time until `done` is true (or 10 s pass). */
  const runUntil = (run: (p: Vector3, s: number) => void, player: Vector3, done: () => boolean) => {
    for (let i = 0; i < 10 / dtSec && !done(); i++) run(player, dtSec);
  };

  it('holds, gives a tell, comes out, fires one burst at Rook, and goes back in', () => {
    const { enemy, world, shots, run } = holding(lowSpot);
    world.seenWhenOut = true;
    const { tellSec, peekOutSec, peekBackSec, roundIntervalSec } = standInConfig;
    const { burstRounds } = roleConfig.trooper;
    run(rook, holdSec(0.99) + tellSec + peekOutSec + burstRounds * roundIntervalSec + peekBackSec + 0.2);
    expect(world.tells).toHaveLength(1);
    expect(world.tells[0]).toBeGreaterThan(holdSec(0.99) - 1.6); // after the hold (it arrived during the first 1.5 s)
    expect(shots).toHaveLength(burstRounds);
    expect(shots.every((s) => s.shot !== 'cover')).toBe(true); // aimed at Rook, who could be seen
    expect(shots[0].atSec - world.tells[0]).toBeGreaterThanOrEqual(tellSec + peekOutSec - 2 * dtSec); // the tell comes first
    expect(enemy.peekOut).toBe(0); // back in
    expect(enemy.state).toBe('cover');
  });

  it('rises over low cover while out, and is crouched again when back', () => {
    const { enemy, world, run } = holding(lowSpot);
    world.seenWhenOut = true;
    expect(enemy.heightM).toBe(standInConfig.crouchHeightM);
    runUntil(run, rook, () => enemy.peekOut >= 1);
    expect(enemy.peekOut).toBe(1);
    expect(enemy.heightM).toBeCloseTo(dummyConfig.heightM, 5);
    expect(enemy.feet.x).toBeCloseTo(0, 5); // it rises in place
    run(rook, 2);
    expect(enemy.heightM).toBe(standInConfig.crouchHeightM);
  });

  it('steps out of high cover to the open side that lets it see Rook, and back to its spot', () => {
    const { enemy, world, run } = holding(highSpot);
    world.seesFrom = (eyes) => eyes.x > 0; // only the east side sees him
    runUntil(run, rook, () => enemy.peekOut >= 1);
    expect(enemy.peekOut).toBe(1);
    expect(enemy.feet.x).toBeCloseTo(standInConfig.peekStepM, 5); // facing south, east is its left: it chose the side that sees
    expect(enemy.feet.z).toBeCloseTo(-3, 5);
    run(rook, 2);
    expect(enemy.feet.x).toBeCloseTo(0, 5);
  });

  it('a peek that finds Rook hidden fires at his cover when the chance comes up, and only looks when it does not', () => {
    const lucky = holding(lowSpot, standInConfig.hiddenFireChance / 2); // every roll below the chance
    lucky.enemy.hear(noiseAt(new Vector3(0, 1.6, 10), 30)); // fresh knowledge of where he is
    lucky.run(rook, holdSec(standInConfig.hiddenFireChance / 2) + 2);
    expect(lucky.shots.length).toBe(roleConfig.trooper.burstRounds);
    expect(lucky.shots.every((s) => s.shot === 'cover')).toBe(true);
    const unlucky = holding(lowSpot, 0.99); // every roll above it
    unlucky.run(rook, holdSec(0.99) + 2);
    expect(unlucky.world.tells).toHaveLength(1); // it did peek
    expect(unlucky.shots).toHaveLength(0);
  });

  it('from low cover with an open side, it steps out crouched when only the side sees Rook', () => {
    const sideSpot: CoverPoint = { ...lowSpot, lean: 'both' };
    const { enemy, world, run } = holding(sideSpot);
    // Facing south, its left is east. Only eyes east of the spot at crouched height see him.
    world.seesFrom = (eyes) => eyes.x > 0.3 && eyes.y < 1;
    runUntil(run, rook, () => enemy.peekOut >= 1);
    expect(enemy.feet.x).toBeCloseTo(standInConfig.crouchPeekStepM, 5);
    expect(enemy.crouched).toBe(true);
    expect(enemy.heightM).toBe(standInConfig.crouchHeightM); // it stays crouched
    run(rook, 2);
    expect(enemy.feet.x).toBeCloseTo(0, 5);
  });

  it('from low cover with open sides, it rises when only the top sees Rook', () => {
    const sideSpot: CoverPoint = { ...lowSpot, lean: 'both' };
    const { enemy, world, run } = holding(sideSpot);
    world.seesFrom = (eyes) => eyes.y > 1.5 && Math.abs(eyes.x) < 0.01; // standing, over the spot
    runUntil(run, rook, () => enemy.peekOut >= 1);
    expect(enemy.feet.x).toBeCloseTo(0, 5);
    expect(enemy.heightM).toBeCloseTo(dummyConfig.heightM, 5);
  });

  it('on old knowledge a peek only looks: it fires at his cover only if it saw or heard him recently', () => {
    const { enemy, world, shots, run } = holding(lowSpot, standInConfig.hiddenFireChance / 2); // every roll would fire
    run(rook, standInConfig.memoryFreshSec + 1); // nothing new about Rook for longer than its memory stays fresh
    expect(enemy.knowsFresh).toBe(false);
    shots.length = 0; // count only what the peeks on old knowledge do
    const toldBefore = world.tells.length;
    runUntil(run, rook, () => world.tells.length > toldBefore);
    run(rook, 1.5);
    expect(shots.filter((s) => s.shot === 'cover')).toHaveLength(0);
    enemy.hear(noiseAt(new Vector3(0, 1.6, 10), 30)); // heard again: fresh
    expect(enemy.knowsFresh).toBe(true);
  });

  it('peeks again after another hold', () => {
    const { world, run } = holding(lowSpot);
    run(rook, 2 * (holdSec(0.99) + 1.5));
    expect(world.tells).toHaveLength(2);
  });

  it('with Rook close in front of cover that still hides it, a crouched side peek fires and goes back, staying crouched', () => {
    const sideSpot: CoverPoint = { ...lowSpot, lean: 'both' };
    const { enemy, world, shots, run } = holding(sideSpot);
    world.seenWhenOut = true;
    world.seesFrom = (eyes) => eyes.x > 0.3 && eyes.y < 1; // only the crouched step east sees him
    const near = new Vector3(0, 0, 2); // 5 m south, inside the stand-ground range
    runUntil(run, near, () => enemy.peekOut >= 1);
    run(near, 0.5);
    expect(enemy.state).toBe('cover'); // no stand-and-fight while its cover works (decision 218)
    expect(enemy.heightM).toBe(standInConfig.crouchHeightM);
    expect(shots.length).toBeGreaterThan(0);
    run(near, 1);
    expect(enemy.peekOut).toBe(0); // back in
  });

  it('up close with its cover failing, it still stands and fights', () => {
    const { enemy, world, run } = holding(lowSpot);
    world.sees = true;
    world.coverHides = false;
    run(new Vector3(0, 0, 2), 0.6);
    expect(enemy.state).toBe('fight');
    expect(enemy.crouched).toBe(false);
  });
});

describe('StandInEnemy wounded (4.4 follow-up)', () => {
  const firstSpot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI };
  const nextSpot: CoverPoint = { xM: 0, zM: -9, height: 'high', facingYawRad: Math.PI, lean: 'both' };
  const woundingDamage = roleConfig.trooper.healthPoints * (1 - standInConfig.woundedHealthShare) + 1;

  it('counts as wounded below its share of health', () => {
    const { enemy } = setup();
    expect(enemy.wounded).toBe(false);
    enemy.hit('body', woundingDamage);
    expect(enemy.wounded).toBe(true);
  });

  it('rushed while wounded, it does not stand its ground: it backs off to cover at once, still firing', () => {
    const { enemy, world, shots, run } = setup();
    world.sees = false;
    world.cover = firstSpot;
    enemy.hit('body', woundingDamage);
    run(new Vector3(0, 0, 20), 3);
    expect(enemy.state).toBe('cover');
    world.sees = true;
    world.coverHides = false;
    world.cover = nextSpot;
    run(new Vector3(0, 0, 1), 0.3); // 4 m away: an unhurt one would fight here for 2 s
    expect(enemy.state).toBe('retreat');
    run(new Vector3(0, 0, 1), 1.5);
    expect(shots.length).toBeGreaterThan(0); // it fires as it backs off
  });

  it('holds longer between peeks while wounded', () => {
    const roll = 0.5;
    const holdSec = standInConfig.peekHoldMinSec + roll * (standInConfig.peekHoldMaxSec - standInConfig.peekHoldMinSec);
    const tellAt = (wounded: boolean) => {
      const { enemy, world, run } = setup(roll);
      world.sees = false;
      world.cover = firstSpot;
      enemy.hit('body', wounded ? woundingDamage : 1);
      for (let i = 0; i < 20 / dtSec && world.tells.length === 0; i++) run(new Vector3(0, 0, 20), dtSec);
      return world.tells[0];
    };
    const gapSec = tellAt(true) - tellAt(false);
    expect(gapSec).toBeCloseTo(holdSec * (standInConfig.woundedHoldScale - 1), 1);
  });
});

describe('StandInEnemy and grenades (4.4 follow-up)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI };
  const rook = new Vector3(0, 0, 15);

  function holding() {
    const s = setup();
    s.world.sees = false;
    s.world.cover = spot;
    s.enemy.hit('body', 1);
    s.run(rook, 2);
    expect(s.enemy.state).toBe('cover');
    s.world.clockSec = 0;
    return s;
  }

  it('seeing a grenade near it, it reacts after a moment and runs to safety, not firing, faster than it walks', () => {
    const { enemy, world, shots, run } = holding();
    world.grenade = new Vector3(0.5, 0.05, -2.5); // right at its spot
    world.fleeTo.set(0, 0, -12);
    run(rook, standInConfig.grenadeReactionSec - 0.1);
    expect(enemy.state).toBe('cover'); // not yet: it has not reacted
    run(rook, 0.2 + 1 / standInConfig.sightChecksPerSec);
    expect(enemy.state).toBe('flee');
    expect(world.spotted).toBe(1);
    expect(enemy.crouched).toBe(false);
    const zBefore = enemy.feet.z;
    run(rook, 1);
    expect(zBefore - enemy.feet.z).toBeGreaterThan(roleConfig.trooper.walkSpeedMps); // running, not walking
    expect(shots).toHaveLength(0);
  });

  it('once its flee spot is out of the blast, it takes that cover at once', () => {
    const { enemy, world, run } = holding();
    const refuge: CoverPoint = { xM: 0, zM: -12, height: 'low', facingYawRad: Math.PI };
    world.grenade = new Vector3(0, 0.05, -2.8);
    world.fleeTo.set(0, 0, -12);
    world.fleeCover = refuge;
    run(rook, 3.5);
    expect(enemy.state).toBe('cover');
    expect(enemy.cover).toBe(refuge);
    expect(enemy.feet.distanceTo(new Vector3(0, 0, -12))).toBeLessThan(standInConfig.coverArriveM + 0.05);
  });

  it('if the grenade still threatens it where it ran to, it waits, then carries on once the grenade has gone off', () => {
    const { enemy, world, run } = holding();
    world.grenade = new Vector3(0, 0.05, -2.8);
    world.fleeTo.set(0, 0, -7); // still inside the danger zone (the grenade rolled, say)
    run(rook, 3);
    expect(enemy.state).toBe('flee');
    expect(enemy.feet.distanceTo(new Vector3(0, 0, -7))).toBeLessThan(standInConfig.coverArriveM + 0.05);
    world.grenade = null; // it went off
    run(rook, 0.1);
    expect(enemy.state).not.toBe('flee');
  });

  it('ignores a grenade it cannot see, or one too far away to hurt it', () => {
    const hidden = holding();
    hidden.world.grenade = new Vector3(0, 0.05, -2.5);
    hidden.world.grenadeVisible = false;
    hidden.run(rook, 1);
    expect(hidden.enemy.state).toBe('cover');
    const far = holding();
    far.world.grenade = new Vector3(0, 0.05, -3 - grenadeConfig.blastRadiusM - standInConfig.grenadeMarginM - 0.5);
    far.run(rook, 1);
    expect(far.enemy.state).toBe('cover');
  });

  it('never stops to fight while running, even with Rook close', () => {
    const { enemy, world, shots, run } = holding();
    world.grenade = new Vector3(0, 0.05, -2.5);
    world.fleeTo.set(0, 0, -12);
    world.sees = true;
    run(new Vector3(0, 0, 0), 1.5); // Rook 3 m away, in sight
    expect(enemy.state).toBe('flee');
    expect(shots).toHaveLength(0);
  });
});

describe('StandInEnemy: noises away from Rook, and failed walks (4.4 follow-up, decision 219)', () => {
  const spot: CoverPoint = { xM: 0, zM: -5, height: 'low', facingYawRad: Math.PI };

  it('a bullet impact or a grenade wakes it, but does not tell it where Rook is', () => {
    const { enemy } = setup();
    enemy.hear({ kind: 'impact', position: new Vector3(4, 1, 0), radiusM: 15 });
    expect(enemy.awake).toBe(true);
    expect(enemy.knowsWhere).toBe(false);
    enemy.hear({ kind: 'footstep', position: new Vector3(-3, 0, 2), radiusM: 15 });
    enemy.hear({ kind: 'impact', position: new Vector3(4, 1, 0), radiusM: 15 });
    enemy.hear({ kind: 'grenade-blast', position: new Vector3(4, 1, 0), radiusM: 80 });
    expect(enemy.lastKnown.toArray()).toEqual([-3, 0, 2]); // still where it heard his step
  });

  it('with no route to its cover, it gives the spot up instead of standing there forever', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.cover = spot;
    world.routeFails = true;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 20), 0.5);
    expect(world.releases).toBeGreaterThan(1); // it let the spot go (and keeps trying, as the spot is offered again)
    expect(enemy.feet.toArray()).toEqual([0, 0, 0]);
  });

  it('stuck on the way to its cover, it gives up after its stuck time', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.cover = spot;
    world.wallAtZ = -1; // it cannot get past z -1
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 20), 0.5 + 0.2); // it reaches the wall
    const releasesAtWall = world.releases;
    run(new Vector3(0, 0, 20), standInConfig.walkStuckSec + 0.2);
    expect(world.releases).toBeGreaterThan(releasesAtWall);
  });

  it('running from a grenade with no route, it stops running and carries on as usual', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    world.cover = { xM: 0, zM: -2, height: 'low', facingYawRad: Math.PI };
    enemy.hit('body', 1);
    run(new Vector3(0, 0, 15), 2);
    world.grenade = new Vector3(0, 0.05, -1.5);
    world.fleeTo.set(0, 0, -12);
    world.routeFails = true;
    run(new Vector3(0, 0, 15), 1);
    expect(enemy.state).not.toBe('flee');
  });
});

describe('StandInWorld', () => {
  let navigation: Navigation;
  beforeAll(async () => {
    navigation = await Navigation.create(buildGreybox().navigationGeometry);
  });
  const farProp: RoomBox = { kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 };
  const backWall: RoomBox = { kind: 'wall', xM: 0, zM: 5, widthM: 20, depthM: 0.3, heightM: 8 }; // behind the player, tall enough to catch high misses
  const player = rookAt(0, 0);

  const setupWorld = (boxes: RoomBox[]) => {
    player.exposure = 0;
    player.position.set(0, 0, 0);
    player.eyes.set(0, 1.6, 0);
    player.inView = () => true;
    const events = new EventBus<WeaponEvents>();
    const damage: number[] = [];
    const damageFrom: Vector3[] = [];
    const cracks: { position: Vector3; distanceM: number }[] = [];
    events.on('shot:near-miss', ({ position, distanceM }) => cracks.push({ position: position.clone(), distanceM }));
    const pins: { anchor: Vector3; side: Vector3 }[] = [];
    events.on('cover:pinned', ({ anchor, side }) => pins.push({ anchor: anchor.clone(), side: side.clone() }));
    const landed: { muzzle: Vector3; end: Vector3; hit: boolean; shooter: string }[] = [];
    const fired: Vector3[] = [];
    events.on('shot:landed', (s) => landed.push({ muzzle: s.muzzle.clone(), end: s.end.clone(), hit: s.hit, shooter: s.shooter }));
    events.on('enemy:fired', ({ position }) => fired.push(position.clone()));
    const { collision } = buildGreybox([farProp, ...boxes]);
    const world = new StandInWorld(events, collision, navigation, new CoverPoints([], collision), player, (amount, from) => {
      damage.push(amount);
      damageFrom.push(from.clone());
    });
    const enemy = new StandInEnemy({ xM: 0, zM: -8, yawRad: Math.PI }, world); // 8 m north, facing south at him
    return { world, enemy, damage, damageFrom, landed, fired, cracks, pins };
  };

  it('sees the player in the open, not through a wall', () => {
    expect(setupWorld([]).world.canSeePlayer(setupWorld([]).enemy)).toBe(true);
    const blocked = setupWorld([{ kind: 'wall', xM: 0, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 }]);
    expect(blocked.world.canSeePlayer(blocked.enemy)).toBe(false);
  });

  it('a hit hurts the player and lands on his chest; the shot is marked as an enemy shot', () => {
    const { world, enemy, damage, damageFrom, landed, fired } = setupWorld([backWall]);
    world.fire(enemy, 'hit');
    expect(damage).toEqual([enemyGunConfig.rifle.damagePerHit]); // a trooper carries the rifle (4.12)
    expect(damageFrom[0].toArray()).toEqual(fired[0].toArray()); // the arc points at its muzzle
    expect(landed[0].shooter).toBe('enemy');
    expect(landed[0].hit).toBe(false); // no bullet mark on the player
    expect(landed[0].end.toArray()).toEqual([0, 1.6 * standInConfig.aimHeightShareOfEyes, 0]);
    expect(fired[0].z).toBeCloseTo(-8 + standInConfig.muzzleForwardM, 5); // the muzzle is in front of it, toward him
  });

  it('the damage of a hit comes from its gun: pistol for a flanker, rifle for a trooper or leader, machine gun for the heavy (4.12)', () => {
    const { world, damage } = setupWorld([backWall]);
    for (const role of roles) {
      world.fire(new StandInEnemy({ xM: 0, zM: -8, yawRad: Math.PI, role }, world), 'hit');
      expect(damage.pop(), role).toBe(enemyGunConfig[gunOfRole[role]].damagePerHit);
    }
    expect(enemyGunConfig.pistol.damagePerHit).toBeLessThan(enemyGunConfig.lmg.damagePerHit);
    expect(enemyGunConfig.lmg.damagePerHit).toBeLessThan(enemyGunConfig.rifle.damagePerHit);
  });

  it('a shot at his cover aims at where it last knew he was, not where he really is', () => {
    const wide = setupWorld([{ kind: 'wall', xM: 0, zM: -1, widthM: 12, depthM: 0.3, heightM: 3 }]);
    wide.enemy.hear(noiseAt(new Vector3(3, 1.6, 0), 30)); // it heard him 3 m east of where he really stands
    wide.world.fire(wide.enemy, 'cover');
    expect(wide.landed[0].hit).toBe(true);
    expect(wide.landed[0].end.x).toBeGreaterThan(2); // toward x 3, not x 0
    expect(wide.damage).toHaveLength(0);
  });

  it('a shot at his cover aims straight at his chest and strikes what hides him, without hurting him', () => {
    const { world, enemy, damage, landed } = setupWorld([{ kind: 'wall', xM: 0, zM: -1, widthM: 4, depthM: 0.3, heightM: 3 }]);
    world.fire(enemy, 'cover');
    expect(damage).toHaveLength(0);
    expect(landed[0].hit).toBe(true);
    expect(landed[0].end.z).toBeCloseTo(-1.15, 2); // the face of the wall that hides him
    expect(Math.abs(landed[0].end.x)).toBeLessThan(0.01); // straight at him, no offset
  });

  /** How far a shot's line passes from his chest. */
  const passFromChestM = (shot: { muzzle: Vector3; end: Vector3 }): number => {
    const chest = new Vector3(0, 1.6 * standInConfig.aimHeightShareOfEyes, 0);
    const direction = new Vector3().subVectors(shot.end, shot.muzzle).normalize();
    return chest.sub(shot.muzzle).cross(direction).length();
  };

  it('a miss never hurts and passes farther from his chest at low exposure than at full (impacts get closer)', () => {
    // The offset is set square to the shot at his distance, so the line itself passes a hair closer (under 2% here).
    for (const [exposure, offsetM] of [[0, exposureConfig.missFarOffsetM], [1, exposureConfig.missNearOffsetM]]) {
      const { world, enemy, damage, landed } = setupWorld([backWall]);
      player.exposure = exposure;
      for (let i = 0; i < 100; i++) world.fire(enemy, 'miss');
      expect(damage).toHaveLength(0);
      for (const shot of landed) {
        expect(passFromChestM(shot)).toBeGreaterThanOrEqual(offsetM * 0.98);
        expect(passFromChestM(shot)).toBeLessThanOrEqual(offsetM + 1e-6);
        expect(shot.hit).toBe(true); // the back wall or the floor
      }
    }
  });

  it('misses prefer striking his cover: most end on the low wall in front of him', () => {
    const lowWall: RoomBox = { kind: 'prop', xM: 0, zM: -1, widthM: 4, depthM: 0.3, heightM: 1 };
    const { world, enemy, landed } = setupWorld([lowWall]); // nothing behind him: a miss that passes flies on
    for (let i = 0; i < 200; i++) world.fire(enemy, 'miss');
    const chest = new Vector3(0, 1.6 * standInConfig.aimHeightShareOfEyes, 0);
    const near = landed.filter((shot) => shot.hit && shot.end.distanceTo(chest) <= exposureConfig.missNearSurfaceM).length;
    expect(near / landed.length).toBeGreaterThan(0.75);
  });

  it('a miss that flies past his head cracks; one stopped by his cover does not', () => {
    const open = setupWorld([backWall]);
    player.exposure = 1; // misses pass 0.3 m from his chest
    for (let i = 0; i < 50; i++) open.world.fire(open.enemy, 'miss');
    const passed = open.landed.filter((shot) => shot.end.z > 0.5).length; // ended behind him
    expect(passed).toBeGreaterThan(0);
    expect(open.cracks).toHaveLength(passed);
    for (const crack of open.cracks) expect(crack.distanceM).toBeLessThanOrEqual(exposureConfig.crackRadiusM);
    const covered = setupWorld([{ kind: 'wall', xM: 0, zM: -1, widthM: 4, depthM: 0.3, heightM: 3 }]);
    covered.world.fire(covered.enemy, 'cover');
    expect(covered.cracks).toHaveLength(0);
  });

  it('measures what it sees of him: all of him in the open, head and chest over a low wall, nothing while idle', () => {
    const open = setupWorld([]);
    expect(open.world.glimpse(open.enemy, 1).visibleShare).toBe(0); // idle: it has not noticed him
    open.enemy.hit('body', 1);
    const seen = open.world.glimpse(open.enemy, 1);
    expect(seen.visibleShare).toBe(1);
    expect(seen.distanceM).toBeCloseTo(8, 5);
    expect(seen.fromSide).toBe(false); // he looks north, at it
    const low = setupWorld([{ kind: 'prop', xM: 0, zM: -1, widthM: 4, depthM: 0.3, heightM: 1 }]);
    low.enemy.hit('body', 1);
    expect(low.world.glimpse(low.enemy, 1).visibleShare).toBeCloseTo(2 / 3, 5); // the hips are hidden
  });

  it('remembers the spot it saw him from: in view of it while it hides, until he moves out of view of it', () => {
    const { world, enemy } = setupWorld([{ kind: 'wall', xM: -3, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 }]);
    enemy.hit('body', 1);
    expect(world.glimpse(enemy, 1).visibleShare).toBe(1);
    enemy.feet.set(-3, 0, -8); // it ducks behind the wall
    const hidden = world.glimpse(enemy, 1);
    expect(hidden.visibleShare).toBe(0);
    expect(hidden.inViewOfLastSpot).toBe(true);
    player.position.set(-6, 0, 0); // he moves out of view of where it saw him from
    player.eyes.set(-6, 1.6, 0);
    expect(world.glimpse(enemy, 1).inViewOfLastSpot).toBe(false);
  });

  it('suppressing fire aims beside where he hides (the edge of his cover) and pins that side', () => {
    const { world, enemy, landed, pins, damage } = setupWorld([backWall]);
    enemy.hear(noiseAt(new Vector3(0, 1.6, 0), 30)); // it knows where he is
    world.fire(enemy, 'suppress');
    expect(damage).toHaveLength(0);
    expect(passFromChestM(landed[0])).toBeCloseTo(squadConfig.suppressEdgeOffsetM, 1);
    expect(pins).toHaveLength(1);
    expect(pins[0].anchor.toArray()).toEqual([0, 0, 0]);
    expect(Math.abs(pins[0].side.x)).toBeCloseTo(1, 5); // square to its line of fire (north to south)
  });

  it('a wall between a noise and its ears muffles it; the surface the noise was made on does not (4.10)', () => {
    const wall: RoomBox = { kind: 'wall', xM: 0, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 };
    const { world } = setupWorld([wall]);
    const ears = new Vector3(0, 1.6, -8);
    expect(world.noiseBlocked(new Vector3(0, 1.6, 0), ears)).toBe(true); // through the wall
    expect(world.noiseBlocked(new Vector3(0, 1.6, -3.85), ears)).toBe(true); // a bullet in the far face: the wall is between
    expect(world.noiseBlocked(new Vector3(0, 1.6, -4.15), ears)).toBe(false); // a bullet in the face toward it
    expect(world.noiseBlocked(new Vector3(0, 0, -6), ears)).toBe(false); // a step on the floor
  });

  it("knows when one of Rook's rounds passes close to it", () => {
    const { world, enemy } = setupWorld([]);
    const muzzle = new Vector3(0, 1.6, 0);
    expect(world.nearMiss(enemy, muzzle, new Vector3(0.5, 1.6, -9))).toBe(true); // half a metre past its head
    expect(world.nearMiss(enemy, muzzle, new Vector3(4, 1.6, -9))).toBe(false); // well wide
  });

  it('Rook sees it only when it is on his screen and nothing is in the way', () => {
    const open = setupWorld([]);
    expect(open.world.rookSees(open.enemy)).toBe(true);
    player.inView = () => false;
    expect(open.world.rookSees(open.enemy)).toBe(false);
    const walled = setupWorld([{ kind: 'wall', xM: 0, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 }]);
    expect(walled.world.rookSees(walled.enemy)).toBe(false);
  });
});

describe('StandInWorld choosing where to move up to (4.9)', () => {
  // Rook at (0, 4). The stand-in starts 8 m north of him, at (0, -4). A crate 5 m north of him has a spot on its far
  // side (5.95 m from him: closer, and hidden); a crate beside him has a spot too close to him.
  const nearCrate: RoomBox = { kind: 'prop', xM: 0, zM: -1, widthM: 1, depthM: 1, heightM: 1 };
  const nearSpot: CoverPoint = { xM: 0, zM: -1.95, height: 'low', facingYawRad: Math.PI };
  const tooCloseCrate: RoomBox = { kind: 'prop', xM: 2, zM: 3, widthM: 1, depthM: 1, heightM: 1 };
  const tooCloseSpot: CoverPoint = { xM: 2, zM: 2.05, height: 'low', facingYawRad: Math.PI };

  const plan = async (points: CoverPoint[]) => {
    const level = buildGreybox([nearCrate, tooCloseCrate]);
    const navigation = await Navigation.create(level.navigationGeometry);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, new CoverPoints(points, level.collision), rookAt(0, 4), () => {});
    return world.planAdvance(new StandInEnemy({ xM: 0, zM: -4, yawRad: Math.PI }, world));
  };

  it('picks a hiding spot at least the gain closer to Rook, but not one too close to him', async () => {
    expect((await plan([nearSpot, tooCloseSpot]))?.point).toBe(nearSpot);
    expect(await plan([tooCloseSpot])).toBeNull();
  });

  it('not a spot whose route is too long in his view, even under covering fire (decision 239)', async () => {
    // Rook at (0, 5); the stand-in far off to the side at (7.5, -5.5) walks about 8 m across open floor to the spot.
    const level = buildGreybox([nearCrate]);
    const navigation = await Navigation.create(level.navigationGeometry);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, new CoverPoints([nearSpot], level.collision), rookAt(0, 5), () => {});
    const enemy = new StandInEnemy({ xM: 7.5, zM: -5.5, yawRad: Math.PI }, world);
    expect(world.planAdvance(enemy)).toBeNull();
    squadConfig.moveMaxExposedM = 30;
    try {
      expect(world.planAdvance(enemy)?.point).toBe(nearSpot);
    } finally {
      squadConfig.moveMaxExposedM = squadConfigDefaults.moveMaxExposedM;
    }
  });
});

describe('StandInWorld: shots from the gun, not the eyes (decision 239)', () => {
  // A long 1 m bench between the stand-in and Rook at (0, 5). Its spot is behind the bench; both side steps stay behind it.
  const bench: RoomBox = { kind: 'prop', xM: 0, zM: -1, widthM: 4, depthM: 1, heightM: 1 };
  const spot: CoverPoint = { xM: 1, zM: -1.95, height: 'low', facingYawRad: Math.PI, lean: 'both' };
  const setupBench = async () => {
    const level = buildGreybox([bench]);
    const navigation = await Navigation.create(level.navigationGeometry);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, new CoverPoints([spot], level.collision), rookAt(0, 5), () => {});
    const enemy = new StandInEnemy({ xM: spot.xM, zM: spot.zM, yawRad: Math.PI }, world);
    enemy.knowsWhere = true;
    enemy.lastKnown.set(0, 0, 5);
    return { world, enemy };
  };

  it('rising over the bench reaches his cover; a crouched side step would fire into the bench', async () => {
    const { world, enemy } = await setupBench();
    expect(world.coverShotClear(enemy, spot, 0, 1)).toBe(true);
    expect(world.coverShotClear(enemy, spot, 1, 1)).toBe(false);
    expect(world.coverShotClear(enemy, spot, -1, -1)).toBe(false);
  });

  it('crouched behind the bench its muzzle is blocked; standing, it is clear', async () => {
    const { world, enemy } = await setupBench();
    enemy.crouched = true;
    expect(world.muzzleClear(enemy, 'hit')).toBe(false);
    enemy.crouched = false;
    expect(world.muzzleClear(enemy, 'hit')).toBe(true);
  });
});

describe('StandInWorld choosing a flank spot (4.7)', () => {
  // Rook at (0, 4) behind a wall to his north, looking north. A long wall at x 2.5 screens the east side from him. The one
  // cover spot is east of a low crate at (5, 4), 90 degrees round from where he looks; the stand-in starts at (5, -4).
  const rookCover: RoomBox = { kind: 'wall', xM: 0, zM: 3, widthM: 2, depthM: 0.3, heightM: 3 };
  const screen: RoomBox = { kind: 'wall', xM: 2.5, zM: -1.3, widthM: 0.3, depthM: 9.4, heightM: 3 };
  const crate: RoomBox = { kind: 'prop', xM: 5, zM: 4, widthM: 1, depthM: 1, heightM: 1 };
  const eastSpot: CoverPoint = { xM: 5.95, zM: 4, height: 'low', facingYawRad: Math.PI / 2, lean: 'both' };

  const plan = async (boxes: RoomBox[], look = new Vector3(0, 0, -1), side = 0) => {
    const level = buildGreybox(boxes);
    const navigation = await Navigation.create(level.navigationGeometry);
    const rook = rookAt(0, 4);
    rook.forward.copy(look);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, new CoverPoints([eastSpot], level.collision), rook, () => {});
    const enemy = new StandInEnemy({ xM: 5, zM: -4, yawRad: Math.PI }, world);
    const result = world.planFlank(enemy, side);
    lastRejects = { ...world.flankRejects };
    return result;
  };
  let lastRejects: FlankRejects | null = null;

  it('picks a spot to his side that hides it, from which a peek sees him, reached out of his view', async () => {
    const result = await plan([rookCover, screen, crate]);
    expect(result?.point).toBe(eastSpot);
    expect(result!.cost).toBeLessThan(100 * squadConfig.flankMaxExposedM + 20);
  });

  it('not a spot in front of where he looks, and it says why (for the dev readout)', async () => {
    expect(await plan([rookCover, screen, crate], new Vector3(1, 0, 0))).toBeNull(); // he looks east, at it
    expect(lastRejects?.inFront).toBe(1);
    expect(describeFlankRejects(lastRejects!)).toBe('no flank spot (1 in front of you)');
  });

  it('not a spot from which a peek cannot see past his cover', async () => {
    const post: RoomBox = { kind: 'wall', xM: 0.8, zM: 4, widthM: 0.3, depthM: 0.3, heightM: 3 }; // right beside him, east
    expect(await plan([rookCover, screen, crate, post])).toBeNull();
  });

  it("a pincer's second flank takes only a spot on the other side of him (4.11)", async () => {
    expect(await plan([rookCover, screen, crate], new Vector3(0, 0, -1), 1)).not.toBeNull(); // the spot is to his right (east)
    expect(await plan([rookCover, screen, crate], new Vector3(0, 0, -1), -1)).toBeNull();
    expect(describeFlankRejects(lastRejects!)).toBe("no flank spot (1 on the first flanker's side)");
  });

  it('not one whose route is too long in his view', async () => {
    expect(await plan([rookCover, crate])).toBeNull(); // no screen: he sees most of the way
    expect(describeFlankRejects(lastRejects!)).toBe('no flank spot (1 route too much in your view)');
  });
});

describe('flanking in the real test room (4.7)', () => {
  it('with Rook at his start spot looking north, some stand-in has a flank spot from its spawn', async () => {
    const level = buildGreybox();
    const navigation = await Navigation.create(level.navigationGeometry);
    const cover = new CoverPoints(greyboxCover, level.collision);
    const rook = rookAt(0, 4.5);
    const found = greyboxStandIns.map((spawn) => {
      const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {});
      return world.planFlank(new StandInEnemy(spawn, world))?.point ?? null;
    });
    expect(found.some((point) => point !== null)).toBe(true);
  });
});

describe('the stand-in in the real test room (4.2)', () => {
  it('with no cover, walks around the pillar to find the player hiding behind it, and never through it', async () => {
    const level = buildGreybox();
    const navigation = await Navigation.create(level.navigationGeometry);
    const player = rookAt(0, 1.5); // just south of the pillar
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
    const player = rookAt(0, 4.5); // the start spot
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

describe('the stand-in and a real grenade in the real test room (4.4 follow-up)', () => {
  it('sees a grenade at its spot, plans a run out of the blast, and does not see one behind its crate', async () => {
    const level = buildGreybox();
    const navigation = await Navigation.create(level.navigationGeometry);
    const cover = new CoverPoints(greyboxCover, level.collision);
    const player = rookAt(0, 4.5);
    const grenades: Vector3[] = [];
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, player, () => {}, () => grenades);
    const enemy = new StandInEnemy({ xM: 1.95, zM: -3, yawRad: -Math.PI / 2 }, world); // west of the tall crate
    const safeM = grenadeConfig.blastRadiusM + standInConfig.grenadeMarginM;
    const seen = new Vector3();
    grenades.push(new Vector3(1.6, 0.05, -2.2)); // on the floor beside it
    expect(world.spotGrenade(enemy, safeM, seen)).toBe(true);
    const out = new Vector3();
    const point = world.planFlee(enemy, seen, safeM, out);
    expect(Math.hypot(out.x - seen.x, out.z - seen.z)).toBeGreaterThanOrEqual(safeM - standInConfig.coverArriveM);
    const onMesh = new Vector3();
    expect(navigation.closestPoint(out, onMesh)).toBe(true);
    expect(Math.hypot(onMesh.x - out.x, onMesh.z - out.z)).toBeLessThan(0.05); // the mesh sits a little above the floor
    if (point) expect(cover.claimedBy(point)).toBe(enemy);
    grenades.length = 0;
    grenades.push(new Vector3(3.9, 0.05, -3)); // just east of the tall crate: the crate is between
    expect(world.spotGrenade(enemy, safeM, seen)).toBe(false);
    expect(world.grenadeNear(enemy.feet, safeM)).toBe(true); // it is there all the same
  });
});

describe('StandInEnemy on a hunt (decision 235)', () => {
  const huntCover: CoverPoint = { xM: 0, zM: -20, height: 'low', facingYawRad: 0, lean: 'both' };
  const far = new Vector3(0, 0, 10);
  /** An awake stand-in, Rook out of sight, its squad's hunt on, sent toward a spot far to the north. */
  const sent = (role: Role, leads: boolean) => {
    const s = setup(0.99, new SquadCoordinator(), role);
    s.world.sees = false;
    s.enemy.hit('body', 1);
    s.run(far, dtSec);
    s.squad.beginHunt({ x: 0, z: -24 }, [s.enemy], () => ({ cost: 1 }), () => true);
    s.enemy.beginHunt(huntCover, leads);
    return s;
  };

  it('the leader goes at its flank speed (no slower than a run), a follower at its run speed', () => {
    const leader = sent('trooper', true);
    leader.run(far, 1);
    expect(leader.enemy.state).toBe('hunt');
    expect(leader.enemy.speedMps).toBeCloseTo(Math.max(roleConfig.trooper.flankSpeedMps, roleConfig.trooper.runSpeedMps), 5); // up to speed after a second (4.15)
    const follower = sent('trooper', false);
    follower.run(far, 1);
    expect(follower.enemy.speedMps).toBeCloseTo(roleConfig.trooper.runSpeedMps, 5);
  });

  it("arriving, it holds cover there and the leader's look starts", () => {
    const { enemy, run, squad } = sent('flanker', true);
    const { flankSpeedMps, accelMps2, brakeMps2 } = roleConfig.flanker;
    run(far, 20 / flankSpeedMps + flankSpeedMps / (2 * accelMps2) + flankSpeedMps / brakeMps2 + 0.5); // with speeding up and slowing down (4.15)
    expect(enemy.state).toBe('cover');
    expect(squad.huntLookingSec).not.toBeNull();
  });

  it('once the hunt stops (Rook found), it takes cover from where it is instead of walking on', () => {
    const { enemy, world, run, squad } = sent('trooper', true);
    run(far, 1);
    const releasesBefore = world.releases;
    squad.watchKnowledge(dtSec, true, true); // someone saw or heard him
    run(far, dtSec * 2);
    expect(enemy.state).toBe('approach'); // no cover hides it in the fake world: the 4.1 behaviour
    expect(world.releases).toBeGreaterThan(releasesBefore);
  });

  it('takes the shared last known spot only if it is newer than its own', () => {
    const { enemy } = setup();
    enemy.hit('body', 1);
    enemy.shareLastKnown(new Vector3(5, 0, 5), 20);
    expect(enemy.lastKnown.x).toBe(5);
    enemy.shareLastKnown(new Vector3(9, 0, 9), 30); // older: ignored
    expect(enemy.lastKnown.x).toBe(5);
    expect(enemy.knowsFresh).toBe(false); // shared knowledge stays old: it only looks there
  });
});

describe('StandInWorld on a hunt: judged from the last known spot (decision 235)', () => {
  // A crate at (0, -1) with a spot on its north side. The squad last knew Rook was at (0, 2), south of the crate, but he
  // has moved to (0, -4), north of it, where that spot does not hide anyone from him. A second spot is too far away.
  const crate: RoomBox = { kind: 'prop', xM: 0, zM: -1, widthM: 1, depthM: 1, heightM: 1 };
  const crateSpot: CoverPoint = { xM: 0, zM: -1.95, height: 'low', facingYawRad: Math.PI };
  const farCrate: RoomBox = { kind: 'prop', xM: 6, zM: -7, widthM: 1, depthM: 1, heightM: 1 };
  const farSpot: CoverPoint = { xM: 6, zM: -7.95, height: 'low', facingYawRad: Math.PI };

  it('the leader takes cover near that spot that hides from it; cover is judged from it while the squad searches', async () => {
    const level = buildGreybox([crate, farCrate]);
    const navigation = await Navigation.create(level.navigationGeometry);
    const squad = new SquadCoordinator();
    const cover = new CoverPoints([crateSpot, farSpot], level.collision);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rookAt(0, -4), () => {}, () => [], Math.random, squad);
    const enemy = new StandInEnemy({ xM: -4, zM: -6, yawRad: 0 }, world);
    expect(world.coverHides(crateSpot)).toBe(false); // from where he really is
    for (let i = 0; i < 60; i++) squad.watchKnowledge(1, true, false);
    const lead = squad.beginHunt({ x: 0, z: 2 }, [enemy], (member) => world.planHuntSpot(member), () => true);
    expect(lead?.plan.point).toBe(crateSpot);
    expect(world.coverHides(crateSpot)).toBe(true); // from where the squad thinks he is
    squad.watchKnowledge(1, true, true); // found him: real eyes again
    expect(world.coverHides(crateSpot)).toBe(false);
  });
});

describe('StandInEnemy flinching under heavy fire (decision 246)', () => {
  const far = new Vector3(0, 0, 10);
  const next: CoverPoint = { xM: 0, zM: -10, height: 'low', facingYawRad: 0 };
  const shelter: CoverPoint = { xM: 12, zM: 0, height: 'low', facingYawRad: 0 };
  const rifleHit = 15;
  /** An awake stand-in moving up north toward `next` in the fake world, Rook out of its sight. */
  const advancing = (role: Role = 'trooper', roll = 0.99) => {
    const s = setup(roll, new SquadCoordinator(), role);
    s.world.sees = false;
    s.world.nearestCover = shelter;
    s.enemy.hit('body', 1); // wakes it (waking does not count toward a flinch)
    s.run(far, 1);
    s.enemy.beginAdvance(next);
    s.run(far, 0.5);
    expect(s.enemy.state).toBe('advance');
    return s;
  };

  it('two quick rifle hits on the move: it flinches, drops its spot, and heads for the nearest cover, slowed at first', () => {
    const { enemy, world, run } = advancing();
    enemy.hit('body', rifleHit);
    expect(enemy.flinching).toBe(false);
    enemy.hit('body', rifleHit);
    expect(enemy.flinching).toBe(true);
    expect(enemy.state).toBe('retreat');
    expect(enemy.cover).toBe(shelter);
    expect(world.advanceOvers).toBe(1); // the squad hears its move is over
    // Running when it flinched, it brakes down to the flinch's share of its run (4.15: no instant change of speed).
    const flinchMps = roleConfig.trooper.runSpeedMps * standInConfig.flinchSpeedShare;
    const before = enemy.feet.clone();
    run(far, 0.25);
    expect(enemy.feet.distanceTo(before)).toBeLessThan(roleConfig.trooper.runSpeedMps * 0.25); // slowed
    expect(enemy.speedMps).toBeLessThanOrEqual(flinchMps + 1e-9);
    run(far, standInConfig.flinchSec);
    expect(enemy.flinching).toBe(false);
    let fastestMps = 0;
    for (let t = 0; t < 0.5; t += dtSec) {
      run(far, dtSec);
      fastestMps = Math.max(fastestMps, enemy.speedMps);
    }
    expect(fastestMps).toBeGreaterThan(flinchMps + 0.5); // then it speeds up again: it runs
  });

  it('hits further apart than the window do not add up', () => {
    const { enemy, run } = advancing();
    enemy.hit('body', rifleHit);
    run(far, standInConfig.flinchWindowSec + 0.1);
    enemy.hit('body', rifleHit);
    expect(enemy.flinching).toBe(false);
    expect(enemy.state).toBe('advance');
  });

  it('no stun lock: no second flinch until a while after one ends', () => {
    const { enemy, run } = advancing();
    enemy.hit('body', 2 * rifleHit);
    expect(enemy.flinching).toBe(true);
    run(far, standInConfig.flinchSec + 0.1);
    enemy.hit('body', 2 * rifleHit);
    expect(enemy.flinching).toBe(false);
    run(far, standInConfig.flinchImmuneSec);
    enemy.hit('body', 2 * rifleHit);
    expect(enemy.flinching).toBe(true);
  });

  it('the heavy needs its own, larger flinch damage', () => {
    const { enemy } = advancing('heavy');
    enemy.hit('body', rifleHit);
    enemy.hit('body', rifleHit);
    expect(enemy.flinching).toBe(roleConfig.heavy.flinchDamage <= 2 * rifleHit);
    enemy.hit('body', rifleHit);
    enemy.hit('body', rifleHit);
    expect(enemy.flinching).toBe(true);
  });

  it('with no cover that hides it, it fights where it stands', () => {
    const { enemy, world } = advancing();
    world.nearestCover = null;
    enemy.hit('body', 2 * rifleHit);
    expect(enemy.state).toBe('fight');
  });

  it('panic fire: on its way to cover it fires back when it sees Rook, at a quarter of the hit chance', () => {
    // The roll (0.1) is under the backing-off hit chance (0.3 x 0.5) but over the panic one (0.3 x 0.25).
    const { enemy, world, shots, run } = advancing('trooper', 0.1);
    world.rookSees = true; // first contact made: its rounds may hit
    run(far, dtSec * 2);
    enemy.hit('body', 2 * rifleHit);
    world.sees = true;
    shots.length = 0;
    run(far, 1.2);
    expect(enemy.state).toBe('retreat');
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => !s.hits)).toBe(true);
  });

  it('peeking: it ducks straight back into cover and fires nothing more', () => {
    const s = setup();
    s.world.sees = false;
    s.world.seenWhenOut = true;
    s.world.cover = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI, lean: 'both' };
    s.enemy.hit('body', 1);
    for (let i = 0; i < 600 && s.enemy.peekOut < 1; i++) s.run(far, dtSec);
    expect(s.enemy.peekOut).toBe(1);
    s.enemy.hit('body', 2 * rifleHit);
    expect(s.enemy.flinching).toBe(true);
    s.shots.length = 0;
    s.run(far, standInConfig.peekBackSec + dtSec * 2);
    expect(s.enemy.peekOut).toBe(0);
    expect(s.shots).toHaveLength(0);
  });

  it('running from a grenade: no flinch, it keeps running', () => {
    const { enemy, world, run } = advancing();
    world.grenade = enemy.feet.clone();
    run(far, standInConfig.grenadeReactionSec + 0.2);
    expect(enemy.state).toBe('flee');
    enemy.hit('body', 2 * rifleHit);
    expect(enemy.flinching).toBe(false);
    expect(enemy.state).toBe('flee');
  });

  it('the heavy fires while it walks to cover it picked itself; others run there without firing', () => {
    const rook = new Vector3(0, 0, 30); // beyond standing-its-ground range
    for (const role of ['heavy', 'trooper'] as const) {
      const s = setup(0.99, new SquadCoordinator(), role);
      s.world.cover = { xM: 0, zM: -20, height: 'low', facingYawRad: 0 };
      s.enemy.hit('body', 1);
      s.run(rook, 2);
      expect(s.enemy.state, role).toBe('approach');
      expect(s.shots.length > 0, role).toBe(role === 'heavy');
    }
  });
});

describe('StandInWorld: the nearest hiding cover after a flinch (decision 246)', () => {
  // Rook at (0, 4); the stand-in at (0, -4). Two crates hide a spot each from him; the one by the stand-in is nearer.
  const nearCrate: RoomBox = { kind: 'prop', xM: 0, zM: -1, widthM: 1, depthM: 1, heightM: 1 };
  const nearSpot: CoverPoint = { xM: 0, zM: -1.95, height: 'low', facingYawRad: Math.PI };
  const farCrate: RoomBox = { kind: 'prop', xM: 5, zM: 1, widthM: 1, depthM: 1, heightM: 1 };
  const farSpot: CoverPoint = { xM: 5, zM: 0.05, height: 'low', facingYawRad: Math.PI };

  it('picks the hiding spot with the shortest walk, and claims it', async () => {
    const level = buildGreybox([nearCrate, farCrate]);
    const navigation = await Navigation.create(level.navigationGeometry);
    const cover = new CoverPoints([farSpot, nearSpot], level.collision);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rookAt(0, 4), () => {});
    const enemy = new StandInEnemy({ xM: 0, zM: -4, yawRad: 0 }, world);
    expect(world.pickNearestCover(enemy)).toBe(nearSpot);
    expect(cover.claimedBy(nearSpot)).toBe(enemy);
  });
});

describe('StandInEnemy throwing a grenade (4.12)', () => {
  const lowSpot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI }; // the cover is to its south, toward Rook
  const rook = new Vector3(0, 0, 10); // 13 m south: beyond the stand-ground range
  const plan = (): ThrowPlan => ({ way: 0, from: new Vector3(0, 1.75, -3), velocity: new Vector3(0, 8, 6), rookAt: rook.clone(), cost: 13 });
  /** Long enough for the tell, coming out and the wind-up. */
  const throwSec = () => standInConfig.tellSec + standInConfig.peekOutSec + enemyGrenadeConfig.throwWindupSec + 0.1;

  /** A stand-in of `role` that has walked to its low cover and is holding there, hidden. */
  function holding(role: Role = 'trooper') {
    const s = setup(0.99, new SquadCoordinator(), role);
    s.world.sees = false;
    s.world.cover = lowSpot;
    s.enemy.hit('body', 1);
    s.run(rook, 2.5); // the heavy runs slowest (1.8 m/s) to its spot 3 m away
    expect(s.enemy.state).toBe('cover');
    return s;
  }

  it('a trooper or leader carries one; a flanker or heavy carries none', () => {
    for (const role of roles) expect(holding(role).enemy.grenades, role).toBe(roleConfig[role].grenades);
    expect(holding('trooper').enemy.canThrow).toBe(true);
    expect(holding('flanker').enemy.canThrow).toBe(false);
    expect(holding('heavy').enemy.canThrow).toBe(false);
  });

  it('peeks at once with the tell, winds up, throws once, holds a firing slot meanwhile, and goes back in', () => {
    const { enemy, world, shots, run, squad } = holding();
    enemy.beginThrow(plan());
    run(rook, standInConfig.tellSec / 2);
    expect(world.tells).toHaveLength(1);
    expect(squad.holdsSlot(enemy)).toBe(true); // a throw takes a firing slot
    expect(world.thrown).toHaveLength(0);
    run(rook, throwSec());
    expect(world.thrown).toHaveLength(1);
    expect(world.throwOvers).toEqual([true]);
    expect(enemy.grenades).toBe(0);
    expect(shots).toHaveLength(0); // it throws instead of firing
    run(rook, standInConfig.peekBackSec + 0.1);
    expect(enemy.peekOut).toBe(0);
    expect(squad.holdsSlot(enemy)).toBe(false);
    expect(enemy.canThrow).toBe(false); // nothing left to throw
  });

  it('throws even when it could see Rook from where it holds (the throw wins over firing)', () => {
    const { enemy, world, shots, run } = holding();
    world.sees = true;
    enemy.beginThrow(plan());
    run(rook, throwSec());
    expect(world.thrown).toHaveLength(1);
    expect(shots).toHaveLength(0);
  });

  it('if Rook has moved away by the release, it does not throw and keeps its grenade', () => {
    const { enemy, world, run } = holding();
    world.throwStillOn = false;
    enemy.beginThrow(plan());
    run(rook, throwSec());
    expect(world.thrown).toHaveLength(0);
    expect(world.throwOvers).toEqual([false]);
    expect(enemy.grenades).toBe(1);
  });

  it('a flinch during the wind-up calls the throw off', () => {
    const { enemy, world, run } = holding();
    enemy.beginThrow(plan());
    run(rook, standInConfig.tellSec + standInConfig.peekOutSec + 0.05); // out, winding up
    enemy.hit('body', roleConfig.trooper.flinchDamage);
    run(rook, enemyGrenadeConfig.throwWindupSec + 0.1);
    expect(world.thrown).toHaveLength(0);
    expect(world.throwOvers).toEqual([false]);
    expect(enemy.grenades).toBe(1);
  });

  it('killed with a throw to make, the squad hears the throw is over', () => {
    const { enemy, world } = holding();
    enemy.beginThrow(plan());
    enemy.kill();
    expect(world.throwOvers).toEqual([false]);
    expect(enemy.isThrowing).toBe(false);
  });
});

describe('StandInEnemy squad basics (4.16)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI, lean: 'both' };
  const far = new Vector3(0, 0, 10);
  /** A trooper holding `spot`, its rifle's magazine `rounds` big for the test (put back afterwards by `withMagazine`). */
  const holding = () => {
    const s = setup();
    s.world.sees = false;
    s.world.cover = spot;
    s.enemy.hit('body', 1);
    s.run(far, 2.5);
    expect(s.enemy.state).toBe('cover');
    s.shots.length = 0;
    return s;
  };
  const withMagazine = (rounds: number, test: () => void) => {
    const was = enemyGunConfig.rifle.magazineRounds;
    enemyGunConfig.rifle.magazineRounds = rounds;
    try {
      test();
    } finally {
      enemyGunConfig.rifle.magazineRounds = was;
    }
  };
  /** Runs in single updates until `done` (at most `maxSec`). */
  const runUntil = (run: (target: Vector3, sec: number) => void, done: () => boolean, maxSec = 20) => {
    for (let t = 0; t < maxSec && !done(); t += dtSec) run(far, dtSec);
    expect(done()).toBe(true);
  };

  it('fires its magazine dry, reloads in cover for its gun\'s reload time without firing, then fires again', () =>
    withMagazine(6, () => {
      const { enemy, world, shots, run } = holding();
      world.sees = true; // it fires from where it holds
      runUntil(run, () => world.reloadStarts === 1);
      expect(shots).toHaveLength(6);
      expect(enemy.reloading).toBe(true);
      expect(enemy.rounds).toBe(0);
      run(far, enemyGunConfig.rifle.reloadSec - 0.1);
      expect(shots).toHaveLength(6); // nothing while reloading
      expect(world.tells).toHaveLength(0); // and no peeks
      run(far, 0.2);
      expect(world.reloadDones).toBe(1);
      expect(enemy.reloading).toBe(false);
      expect(enemy.rounds).toBe(6);
      run(far, 2);
      expect(shots.length).toBeGreaterThan(6); // and fires again
    }));

  it('a flinch cuts a reload short; it reloads again later', () =>
    withMagazine(3, () => {
      const { enemy, world, run } = holding();
      world.sees = true;
      runUntil(run, () => enemy.reloading);
      enemy.hit('body', 15);
      enemy.hit('body', 15); // two quick rifle hits: a flinch
      expect(enemy.flinching).toBe(true);
      expect(enemy.reloading).toBe(false);
      expect(world.reloadDones).toBe(0);
      runUntil(run, () => world.reloadDones === 1);
      expect(world.reloadStarts).toBe(2);
      expect(enemy.rounds).toBe(3);
    }));

  it('tops up in cover when low and calm, not while it still knows fresh where Rook is', () =>
    withMagazine(12, () => {
      const { enemy, world, shots, run } = holding();
      world.sees = true;
      runUntil(run, () => shots.length >= 9);
      world.sees = false; // 3 left: below a third of 12
      expect(enemy.rounds).toBeLessThan(12 / 3);
      expect(enemy.rounds).toBeGreaterThan(0);
      run(far, standInConfig.topUpCalmSec - 0.5);
      expect(world.reloadStarts).toBe(0); // it saw Rook too recently
      runUntil(run, () => world.reloadStarts === 1, 2);
    }));

  it('holds fire while a squadmate is in its line of fire; after a while it wants to move on; fires again once clear', () => {
    const { enemy, world, shots, run } = holding();
    world.sees = true;
    world.friendInLine = true;
    run(far, standInConfig.friendBlockedMoveSec - 0.5);
    expect(shots).toHaveLength(0);
    expect(enemy.wantsToReposition).toBe(false);
    run(far, 1);
    expect(shots).toHaveLength(0);
    expect(enemy.wantsToReposition).toBe(true); // moving on, as when pinned (decision 237)
    world.friendInLine = false;
    run(far, 1);
    expect(shots.length).toBeGreaterThan(0);
  });
});

describe('StandInEnemy holding a push without covering fire (4.17)', () => {
  const spot: CoverPoint = { xM: 0, zM: -3, height: 'low', facingYawRad: Math.PI, lean: 'both' };
  const goal: CoverPoint = { xM: 6, zM: -3, height: 'low', facingYawRad: Math.PI };
  const hold: CoverPoint = { xM: 2.5, zM: -2, height: 'low', facingYawRad: Math.PI };
  const far = new Vector3(0, 0, 10);
  /** A stand-in of `role` holding `spot`, with `hold` on offer as the spot a held push stops at. */
  const holding = (role: Role = 'trooper') => {
    const s = setup(0.99, new SquadCoordinator(), role);
    s.world.sees = false;
    s.world.cover = spot;
    s.world.holdSpot = hold;
    s.enemy.hit('body', 1);
    s.run(far, 3); // the heavy walks slower
    expect(s.enemy.state).toBe('cover');
    return s;
  };
  /** A held push: covered by the squad, its cover gone 0.3 s into the move. */
  const held = () => {
    const s = holding();
    s.enemy.beginAdvance(goal, 'squad');
    s.run(far, 0.3);
    s.world.coverLive = false;
    s.run(far, squadConfig.coverLostSec + 0.1);
    return s;
  };

  it('with its covering fire on, it goes all the way', () => {
    const { enemy, world, run } = holding();
    enemy.beginAdvance(goal, 'squad');
    run(far, 4);
    expect(enemy.cover).toBe(goal);
    expect(world.pushHelds).toBe(0);
  });

  it('its covering fire gone for a moment, it turns off to near cover, calls for cover, and asks again every so often', () => {
    const { enemy, world, run } = held();
    expect(enemy.holdingPush).toBe(true);
    expect(enemy.cover).toBe(hold);
    expect(world.pushHelds).toBe(1);
    expect(world.advanceOvers).toBe(1); // the squad's play is over
    run(far, 2);
    expect(enemy.state).toBe('cover');
    expect(enemy.asksForCover).toBe(true);
    enemy.askedForCover();
    expect(enemy.asksForCover).toBe(false);
    run(far, squadConfig.askCoverEverySec + 0.05);
    expect(enemy.asksForCover).toBe(true);
  });

  it('a short gap in the fire (less than coverLostSec) does not stop it', () => {
    const { enemy, world, run } = holding();
    enemy.beginAdvance(goal, 'squad');
    run(far, 0.3);
    world.coverLive = false;
    run(far, squadConfig.coverLostSec - 0.1);
    world.coverLive = true;
    run(far, 4);
    expect(world.pushHelds).toBe(0);
    expect(enemy.cover).toBe(goal);
  });

  it('covered again, it goes on to the spot it was pushing to', () => {
    const { enemy, world, run } = held();
    run(far, 2);
    world.coverLive = true;
    enemy.resumePush('squad');
    expect(enemy.state).toBe('advance');
    expect(enemy.holdingPush).toBe(false);
    run(far, 3);
    expect(enemy.cover).toBe(goal);
    expect(enemy.state).toBe('cover');
  });

  it('with no cover for pushGiveUpSec, it gives the push up and stays where it holds', () => {
    const { enemy, run } = held();
    run(far, squadConfig.pushGiveUpSec);
    expect(enemy.holdingPush).toBe(false);
    expect(enemy.cover).toBe(hold);
    expect(enemy.state).toBe('cover');
  });

  it('with no near cover to stop at (or its goal nearer), it keeps going', () => {
    const { enemy, world, run } = holding();
    world.holdSpot = null;
    enemy.beginAdvance(goal, 'squad');
    world.coverLive = false;
    run(far, 4);
    expect(world.pushHelds).toBe(0);
    expect(enemy.cover).toBe(goal);
  });

  it('a move nobody covers (a hidden route), a flank or a hunt never holds', () => {
    const uncovered = holding();
    uncovered.world.coverLive = false;
    uncovered.enemy.beginAdvance(goal);
    uncovered.run(far, 4);
    expect(uncovered.world.pushHelds).toBe(0);
    expect(uncovered.enemy.cover).toBe(goal);

    const flank = holding();
    flank.world.coverLive = false;
    flank.world.rookSees = false;
    flank.enemy.beginFlank(goal);
    flank.run(far, 1);
    expect(flank.world.pushHelds).toBe(0);
    expect(flank.enemy.state).toBe('flank');
  });

  it('the heavy, its own cover, holds when its gun runs dry on the move, and says the push is its own', () => {
    const was = enemyGunConfig.lmg.magazineRounds;
    enemyGunConfig.lmg.magazineRounds = 2;
    try {
      const { enemy, world, run } = holding('heavy');
      world.sees = true; // it fires on the move
      enemy.beginAdvance(goal, 'self');
      for (let t = 0; t < 4 && !enemy.holdingPush; t += dtSec) run(far, dtSec);
      expect(enemy.holdingPush).toBe(true);
      expect(enemy.reloading).toBe(true);
      expect(enemy.heldBySelf).toBe(true);
      expect(world.pushHelds).toBe(1);
    } finally {
      enemyGunConfig.lmg.magazineRounds = was;
    }
  });

  it('reset (a restart), a held push is gone', () => {
    const { enemy } = held();
    enemy.reset();
    expect(enemy.holdingPush).toBe(false);
  });
});

describe('StandInWorld: where a held push stops, and whether it may go on (4.17)', () => {
  // Rook at (0, 6); the mover at (0, -4). A crate 2 m ahead hides a spot from him; another crate is 6 m off.
  const nearCrate: RoomBox = { kind: 'prop', xM: 0, zM: -1, widthM: 1, depthM: 1, heightM: 1 };
  const nearSpot: CoverPoint = { xM: 0, zM: -1.95, height: 'low', facingYawRad: Math.PI };
  const farCrate: RoomBox = { kind: 'prop', xM: 6, zM: -3, widthM: 1, depthM: 1, heightM: 1 };
  const farSpot: CoverPoint = { xM: 6, zM: -3.95, height: 'low', facingYawRad: Math.PI };
  const make = async () => {
    const level = buildGreybox([nearCrate, farCrate]);
    const navigation = await Navigation.create(level.navigationGeometry);
    const cover = new CoverPoints([farSpot, nearSpot], level.collision);
    const squad = new SquadCoordinator();
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rookAt(0, 6), () => {}, () => [], Math.random, squad);
    const enemy = new StandInEnemy({ xM: 0, zM: -4, yawRad: 0 }, world);
    return { world, enemy, cover, squad };
  };

  it('the nearest free hiding spot within reach, only if nearer than its goal; it claims nothing', async () => {
    const { world, enemy, cover } = await make();
    expect(world.pickHoldSpot(enemy, farSpot)).toBe(nearSpot);
    expect(cover.claimedBy(nearSpot)).toBe(null);
    const closeGoal: CoverPoint = { xM: 0.5, zM: -3.5, height: 'low', facingYawRad: Math.PI };
    expect(world.pickHoldSpot(enemy, closeGoal)).toBe(null); // its goal is nearer: it keeps going
    cover.claim(nearSpot, {});
    expect(world.pickHoldSpot(enemy, farSpot)).toBe(null); // taken; the far one is out of reach
  });

  it('it may go on only to a goal nobody else took that still hides it', async () => {
    const { world, enemy, cover } = await make();
    expect(world.canResumeTo(enemy, farSpot)).toBe(true);
    cover.claim(farSpot, {});
    expect(world.canResumeTo(enemy, farSpot)).toBe(false);
    const open: CoverPoint = { xM: 3, zM: 0, height: 'low', facingYawRad: Math.PI }; // nothing between it and Rook
    expect(world.canResumeTo(enemy, open)).toBe(false);
  });

  it('covering fire is live while a suppressor has the job and is not reloading', async () => {
    const { world, enemy, squad } = await make();
    const other = new StandInEnemy({ xM: 3, zM: -4, yawRad: 0 }, world);
    expect(world.coverLive(enemy)).toBe(false); // nobody covers
    squad.assignCover([other], () => true);
    other.beginSuppress();
    expect(world.coverLive(enemy)).toBe(true);
    squad.suppressOver(other);
    expect(world.coverLive(enemy)).toBe(false);
  });
});
