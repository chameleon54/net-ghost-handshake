import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { testArena, testArenaLayout } from '../src/data/testArena';
import { StandInEnemy } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import { EventBus } from '../src/core/events';
import { CoverPoints, coverPointsFromBoxes, type CoverPoint } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { coverConfig } from '../src/config/cover';
import { standInConfig } from '../src/config/standInEnemy';
import { roles, type Role } from '../src/config/roles';
import type { LevelCollision } from '../src/level/collision';
import type { WeaponEvents } from '../src/weapons/events';

// 4.13b: cover choice checks the most promising spots first and stops early. It must pick exactly the spot that checking
// every spot picks (the way it worked before), only with fewer route searches.

/** Checking every spot, as `CoverPoints.best` did before 4.13b (without claiming). */
function bestByCheckingAll(
  cover: CoverPoints,
  owner: object,
  eyes: Vector3,
  feet: Vector3,
  walkM: (point: CoverPoint) => number,
  range: { preferMinM: number; preferMaxM: number },
  fights: (point: CoverPoint) => boolean,
): CoverPoint | null {
  let best: CoverPoint | null = null;
  let bestScore = -Infinity;
  for (const point of cover.points) {
    const holder = cover.claimedBy(point);
    if (holder && holder !== owner) continue;
    if (!cover.hides(point, eyes)) continue;
    const fromThreatM = Math.hypot(point.xM - feet.x, point.zM - feet.z);
    const outOfRangeM = Math.max(range.preferMinM - fromThreatM, fromThreatM - range.preferMaxM, 0);
    const walk = walkM(point);
    if (!Number.isFinite(walk)) continue;
    const blind = fights(point) ? 0 : coverConfig.blindSpotPenalty;
    const score = -(outOfRangeM * coverConfig.rangePenaltyPerM + walk * coverConfig.walkPenaltyPerM + blind);
    if (score > bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

/** A small seeded random generator, so every run tests the same cases. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('cover choice checks the most promising spots first (4.13b)', () => {
  const level = buildGreybox(testArena, testArenaLayout);
  let navigation: Navigation;
  let cover: CoverPoints;
  const onFloor = (xM: number, zM: number, out: Vector3) => navigation.closestPoint(new Vector3(xM, 0, zM), out) && Math.hypot(out.x - xM, out.z - zM) < 0.05;

  beforeAll(async () => {
    navigation = await Navigation.create(level.navigationGeometry);
    const spot = new Vector3();
    cover = new CoverPoints(coverPointsFromBoxes(testArena).filter((p) => onFloor(p.xM, p.zM, spot)), level.collision);
  });

  it('picks the same spot as checking every spot, for 150 positions of Rook and the enemy, with spots taken by others', () => {
    const random = seeded(4130);
    const rook = { position: new Vector3(), eyeHeightNowM: 1.6, eyes: new Vector3(), forward: new Vector3(0, 0, -1), inView: () => true, exposure: 0, movingFast: false };
    const route: Vector3[] = [];
    let routesNow = 0;
    let routesAll = 0;
    let found = 0;
    const randomFloor = (out: Vector3) => {
      for (;;) if (onFloor(-14 + random() * 28, -11 + random() * 22, out)) return out;
    };
    for (let trial = 0; trial < 150; trial++) {
      randomFloor(rook.position);
      rook.eyeHeightNowM = random() < 0.5 ? 1 : 1.6; // crouched or standing
      rook.eyes.set(rook.position.x, rook.eyeHeightNowM, rook.position.z);
      const start = randomFloor(new Vector3());
      const role: Role = roles[Math.floor(random() * roles.length)];
      const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {});
      const enemy = new StandInEnemy({ xM: start.x, zM: start.z, yawRad: 0, role }, world);
      cover.clearClaims();
      for (const point of cover.points) if (random() < 0.2) cover.claim(point, {}); // others hold a fifth of the spots

      // The walk as the world measures it (no live grenades here): the route's length, if it gets there.
      const walkM = (point: CoverPoint) => {
        routesAll++;
        const spot = new Vector3(point.xM, 0, point.zM);
        if (!navigation.findPath(enemy.feet, spot, route) || route[route.length - 1].distanceTo(spot) > standInConfig.coverArriveM) return Infinity;
        let lengthM = 0;
        for (let i = 1; i < route.length; i++) lengthM += route[i - 1].distanceTo(route[i]);
        return lengthM;
      };
      const expected = bestByCheckingAll(cover, enemy, rook.eyes, rook.position, walkM, enemy.values, (point) => world.canFightFrom(point));

      const findPath = navigation.findPath.bind(navigation);
      navigation.findPath = (...args: Parameters<typeof findPath>) => {
        routesNow++;
        return findPath(...args);
      };
      const picked = world.pickCover(enemy);
      navigation.findPath = findPath;

      expect(picked, `trial ${trial}`).toBe(expected);
      if (picked) expect(cover.claimedBy(picked)).toBe(enemy); // still claimed for it
      if (expected) found++;
    }
    expect(found).toBeGreaterThan(100); // most cases have a spot, so the comparison means something
    expect(routesNow).toBeLessThan(routesAll / 3); // and it searched far fewer routes
  });

  it('ties still go to the spot earlier in the list', () => {
    // Every spot hides and every walk is 5 m: all score the same, so the first free one wins, as before.
    class EverySpotHides extends CoverPoints {
      override hides(): boolean {
        return true;
      }
    }
    const points: CoverPoint[] = [0, 1, 2, 3].map((i) => ({ xM: i, zM: 0, height: 'low', facingYawRad: 0 }));
    const spots = new EverySpotHides(points, null as unknown as LevelCollision);
    const owner = {};
    spots.claim(points[0], {});
    const far = new Vector3(100, 1.6, 100);
    const range = { preferMinM: 0, preferMaxM: 1000 };
    expect(spots.best(owner, far, far, () => 5, range, () => true, () => 0)).toBe(points[1]);
    expect(spots.best(owner, far, far, () => 5, range, () => true, () => 5)).toBe(points[1]);
  });
});
