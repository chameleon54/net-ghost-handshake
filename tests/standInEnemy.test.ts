import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { standInConfig } from '../src/config/standInEnemy';
import { EventBus } from '../src/core/events';
import { StandInEnemy, type StandInHooks } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import type { RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import type { Noise } from '../src/stealth/noise';
import type { WeaponEvents } from '../src/weapons/events';

const dtSec = 1 / 60;
const spawn = { xM: 0, zM: 0, yawRad: 0 }; // faces north (-z)

/** A stand-in with fake senses. `roll` is what its random number gives: below the hit chance hits, above it misses. */
function setup(roll = 0.99) {
  const world = { sees: true, clockSec: 0 };
  const shots: { atSec: number; hits: boolean }[] = [];
  const hooks: StandInHooks = {
    canSeePlayer: () => world.sees,
    pushOut: () => {},
    fire: (_enemy, hits) => shots.push({ atSec: world.clockSec, hits }),
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

  it('never walks closer than its closest distance', () => {
    const { enemy, world, run } = setup();
    world.sees = false;
    enemy.hit('body', 1);
    run(new Vector3(0, 0, -3), 3);
    expect(Math.abs(enemy.feet.z - -3)).toBeCloseTo(standInConfig.closestM, 5);
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

describe('StandInWorld', () => {
  const farProp: RoomBox = { kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 };
  const backWall: RoomBox = { kind: 'wall', xM: 0, zM: 5, widthM: 20, depthM: 0.3, heightM: 8 }; // behind the player, tall enough to catch high misses
  const player = { position: new Vector3(0, 0, 0), eyeHeightNowM: 1.6 };

  const setupWorld = (boxes: RoomBox[]) => {
    const events = new EventBus<WeaponEvents>();
    const damage: number[] = [];
    const landed: { muzzle: Vector3; end: Vector3; hit: boolean; shooter: string }[] = [];
    const fired: Vector3[] = [];
    events.on('shot:landed', (s) => landed.push({ muzzle: s.muzzle.clone(), end: s.end.clone(), hit: s.hit, shooter: s.shooter }));
    events.on('enemy:fired', ({ position }) => fired.push(position.clone()));
    const { collision } = buildGreybox([farProp, ...boxes]);
    const world = new StandInWorld(events, collision, player, (amount) => damage.push(amount));
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
