import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { standInConfig } from '../src/config/standInEnemy';
import { squadConfig } from '../src/config/squad';
import { roleConfig, roles, type Role } from '../src/config/roles';
import { SquadCoordinator } from '../src/squad/squadCoordinator';
import { EventBus } from '../src/core/events';
import { StandInEnemy, type StandInHooks, type StandInShot } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
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
import type { Noise } from '../src/stealth/noise';
import type { WeaponEvents } from '../src/weapons/events';

const dtSec = 1 / 60;
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
    mayHit: () => squad.mayHit(),
    hitLanded: () => squad.hitLanded(),
    claimCover: (_e, point) => world.claimed.push(point),
    flankOver: (e) => {
      world.flankOvers++;
      squad.flankOver(e);
    },
    disorganised: () => squad.disorganised,
    downed: (e) => {
      if (e.role === 'leader') squad.leaderDown();
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

  it('four stand-ins in the open: never more than two hold slots, every one gets to fire, and no two hits on Rook within 0.5 s', () => {
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
    const hits = members.flatMap((m) => m.shots.filter((s) => s.hits).map((s) => s.atSec)).sort((a, b) => a - b);
    expect(hits.length).toBeGreaterThan(3);
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(squadConfig.hitGapSec - 1e-9);
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
      expect(-walker.enemy.feet.z, role).toBeCloseTo(values.walkSpeedMps, 1);

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
    expect(enemy.feet.distanceTo(start)).toBeCloseTo(roleConfig.trooper.flankSpeedMps, 0);
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
    step(squadConfig.holdBeforeFlankSec - 0.5);
    expect(members.some((m) => m.enemy.state === 'flank')).toBe(false);
    step(1);
    expect(members[2].enemy.state).toBe('flank');
    expect(members.filter((m) => m.enemy.state === 'flank')).toHaveLength(1);
    step(4); // it arrives (7 m at the flank speed)
    expect(members[2].enemy.state).toBe('cover');
    expect(squad.flanker).toBeNull();
    step(squadConfig.flankWaitSec - 1);
    const flanksSent = () => members.reduce((sum, m) => sum + m.world.claimed.length, 0);
    expect(flanksSent()).toBe(1); // nobody sent during the wait
    step(1.5);
    expect(flanksSent()).toBe(2); // the next flank, after the wait (the cheapest plan again)
  });
});

describe('StandInEnemy walking and shooting', () => {
  it('walks straight at the player at its walk speed while it cannot see him, without firing', () => {
    const { enemy, world, shots, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -20), 1);
    expect(enemy.state).toBe('approach');
    expect(enemy.feet.z).toBeCloseTo(-roleConfig.trooper.walkSpeedMps, 1);
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

  it('keeps the hit budget: even when every roll would hit, only one round in any 0.5 s lands', () => {
    const { enemy, shots, run } = setup(0);
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -5), 4);
    const hits = shots.filter((s) => s.hits).map((s) => s.atSec);
    expect(hits.length).toBeGreaterThan(1);
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(squadConfig.hitGapSec - 1e-9);
    expect(shots.slice(0, roleConfig.trooper.burstRounds).map((s) => s.hits)).toEqual([true, false, false]);
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
    expect(enemy.health.current).toBe(roleConfig.trooper.healthPoints);
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
    return { world, enemy, damage, damageFrom, landed, fired, cracks };
  };

  it('sees the player in the open, not through a wall', () => {
    expect(setupWorld([]).world.canSeePlayer(setupWorld([]).enemy)).toBe(true);
    const blocked = setupWorld([{ kind: 'wall', xM: 0, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 }]);
    expect(blocked.world.canSeePlayer(blocked.enemy)).toBe(false);
  });

  it('a hit hurts the player and lands on his chest; the shot is marked as an enemy shot', () => {
    const { world, enemy, damage, damageFrom, landed, fired } = setupWorld([backWall]);
    world.fire(enemy, 'hit');
    expect(damage).toEqual([standInConfig.damagePerHit]);
    expect(damageFrom[0].toArray()).toEqual(fired[0].toArray()); // the arc points at its muzzle
    expect(landed[0].shooter).toBe('enemy');
    expect(landed[0].hit).toBe(false); // no bullet mark on the player
    expect(landed[0].end.toArray()).toEqual([0, 1.6 * standInConfig.aimHeightShareOfEyes, 0]);
    expect(fired[0].z).toBeCloseTo(-8 + standInConfig.muzzleForwardM, 5); // the muzzle is in front of it, toward him
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

  it('Rook sees it only when it is on his screen and nothing is in the way', () => {
    const open = setupWorld([]);
    expect(open.world.rookSees(open.enemy)).toBe(true);
    player.inView = () => false;
    expect(open.world.rookSees(open.enemy)).toBe(false);
    const walled = setupWorld([{ kind: 'wall', xM: 0, zM: -4, widthM: 4, depthM: 0.3, heightM: 3 }]);
    expect(walled.world.rookSees(walled.enemy)).toBe(false);
  });
});

describe('StandInWorld choosing a flank spot (4.7)', () => {
  // Rook at (0, 4) behind a wall to his north, looking north. A long wall at x 2.5 screens the east side from him. The one
  // cover spot is east of a low crate at (5, 4), 90 degrees round from where he looks; the stand-in starts at (5, -4).
  const rookCover: RoomBox = { kind: 'wall', xM: 0, zM: 3, widthM: 2, depthM: 0.3, heightM: 3 };
  const screen: RoomBox = { kind: 'wall', xM: 2.5, zM: -1.3, widthM: 0.3, depthM: 9.4, heightM: 3 };
  const crate: RoomBox = { kind: 'prop', xM: 5, zM: 4, widthM: 1, depthM: 1, heightM: 1 };
  const eastSpot: CoverPoint = { xM: 5.95, zM: 4, height: 'low', facingYawRad: Math.PI / 2, lean: 'both' };

  const plan = async (boxes: RoomBox[], look = new Vector3(0, 0, -1)) => {
    const level = buildGreybox(boxes);
    const navigation = await Navigation.create(level.navigationGeometry);
    const rook = rookAt(0, 4);
    rook.forward.copy(look);
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, new CoverPoints([eastSpot], level.collision), rook, () => {});
    const enemy = new StandInEnemy({ xM: 5, zM: -4, yawRad: Math.PI }, world);
    return world.planFlank(enemy);
  };

  it('picks a spot to his side that hides it, from which a peek sees him, reached out of his view', async () => {
    const result = await plan([rookCover, screen, crate]);
    expect(result?.point).toBe(eastSpot);
    expect(result!.cost).toBeLessThan(100 * squadConfig.flankMaxExposedM + 20);
  });

  it('not a spot in front of where he looks', async () => {
    expect(await plan([rookCover, screen, crate], new Vector3(1, 0, 0))).toBeNull(); // he looks east, at it
  });

  it('not a spot from which a peek cannot see past his cover', async () => {
    const post: RoomBox = { kind: 'wall', xM: 0.8, zM: 4, widthM: 0.3, depthM: 0.3, heightM: 3 }; // right beside him, east
    expect(await plan([rookCover, screen, crate, post])).toBeNull();
  });

  it('not one whose route is too long in his view', async () => {
    expect(await plan([rookCover, crate])).toBeNull(); // no screen: he sees most of the way
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
