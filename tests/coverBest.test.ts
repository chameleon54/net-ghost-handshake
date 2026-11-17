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
import { squadConfig } from '../src/config/squad';
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

  it('moving up and running from a grenade pick the same spot as checking every spot, with fewer routes', () => {
    // The old ways, copied from before 4.13b's second fix, using the world's own walk and route-in-view measures.
    const exposedCostPerM = 100; // as in standInWorld.ts
    type Inner = { walkM(enemy: StandInEnemy, point: CoverPoint): number; exposedRouteM(route: Vector3[]): number; routeToCover: Vector3[] };
    const advanceByCheckingAll = (world: StandInWorld, enemy: StandInEnemy, eyes: Vector3, position: Vector3) => {
      const inner = world as unknown as Inner;
      const nowM = Math.hypot(enemy.xM - position.x, enemy.zM - position.z);
      let best: { point: CoverPoint; cost: number } | null = null;
      for (const point of cover.points) {
        const holder = cover.claimedBy(point);
        if (point === enemy.cover || (holder && holder !== enemy)) continue;
        const toM = Math.hypot(point.xM - position.x, point.zM - position.z);
        if (toM > nowM - squadConfig.advanceMinGainM || toM < squadConfig.advanceClosestM) continue;
        if (!cover.hides(point, eyes)) continue;
        const walk = inner.walkM(enemy, point);
        if (!Number.isFinite(walk)) continue;
        const exposedM = inner.exposedRouteM(inner.routeToCover);
        if (exposedM > squadConfig.moveMaxExposedM) continue;
        const blind = world.canFightFrom(point) ? 0 : coverConfig.blindSpotPenalty;
        const cost = exposedM * exposedCostPerM + walk * coverConfig.walkPenaltyPerM + blind;
        if (!best || cost < best.cost) best = { point, cost };
      }
      return best;
    };
    const fleeByCheckingAll = (world: StandInWorld, enemy: StandInEnemy, grenade: Vector3, safeM: number, eyes: Vector3) => {
      const inner = world as unknown as Inner;
      let best: CoverPoint | null = null;
      let bestHides = false;
      let bestWalkM = Infinity;
      for (const point of cover.points) {
        const holder = cover.claimedBy(point);
        if (holder && holder !== enemy) continue;
        if (Math.hypot(point.xM - grenade.x, point.zM - grenade.z) < safeM) continue;
        const walk = inner.walkM(enemy, point);
        if (walk > standInConfig.grenadeRunMaxM) continue;
        const hides = cover.hides(point, eyes);
        if ((hides && !bestHides) || (hides === bestHides && walk < bestWalkM)) {
          best = point;
          bestHides = hides;
          bestWalkM = walk;
        }
      }
      return best;
    };

    const random = seeded(4132);
    const rook = { position: new Vector3(), eyeHeightNowM: 1.6, eyes: new Vector3(), forward: new Vector3(0, 0, -1), inView: () => true, exposure: 0, movingFast: false };
    const randomFloor = (out: Vector3) => {
      for (;;) if (onFloor(-14 + random() * 28, -11 + random() * 22, out)) return out;
    };
    const findPath = navigation.findPath.bind(navigation);
    let routes = 0;
    navigation.findPath = (...args: Parameters<typeof findPath>) => {
      routes++;
      return findPath(...args);
    };
    const rayDistance = level.collision.rayDistance.bind(level.collision);
    let rays = 0;
    level.collision.rayDistance = (...args: Parameters<typeof rayDistance>) => {
      rays++;
      return rayDistance(...args);
    };
    /** Runs a plan and counts its route searches and rays. */
    const counted = <R>(run: () => R): [R, { routes: number; rays: number }] => {
      routes = 0;
      rays = 0;
      const result = run();
      return [result, { routes, rays }];
    };
    const safeM = 5;
    const totals = { advanceRaysNow: 0, advanceRaysAll: 0, advanceRoutesNow: 0, advanceRoutesAll: 0, fleeNow: 0, fleeAll: 0, advances: 0, flees: 0 };
    try {
      for (let trial = 0; trial < 150; trial++) {
        randomFloor(rook.position);
        rook.eyeHeightNowM = random() < 0.5 ? 1 : 1.6;
        rook.eyes.set(rook.position.x, rook.eyeHeightNowM, rook.position.z);
        const start = randomFloor(new Vector3());
        // A live grenade within 4 m of the enemy: spots near it are ruled out, and it is what the enemy runs from.
        const grenade = new Vector3(start.x + (random() - 0.5) * 8, 0, start.z + (random() - 0.5) * 8);
        const role: Role = roles[Math.floor(random() * roles.length)];
        const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {}, () => [grenade]);
        const enemy = new StandInEnemy({ xM: start.x, zM: start.z, yawRad: 0, role }, world);
        cover.clearClaims();
        for (const point of cover.points) if (random() < 0.2) cover.claim(point, {});

        const [advanceExpected, advanceAll] = counted(() => advanceByCheckingAll(world, enemy, rook.eyes, rook.position));
        const [advance, advanceNow] = counted(() => world.planAdvance(enemy));
        expect(advance?.point, `advance, trial ${trial}`).toBe(advanceExpected?.point);
        expect(advance?.cost, `advance cost, trial ${trial}`).toBe(advanceExpected?.cost);

        const [fleeExpected, fleeAll] = counted(() => fleeByCheckingAll(world, enemy, grenade, safeM, rook.eyes));
        const [flee, fleeNow] = counted(() => world.planFlee(enemy, grenade, safeM, new Vector3()));
        expect(flee, `flee, trial ${trial}`).toBe(fleeExpected);

        totals.advanceRaysNow += advanceNow.rays;
        totals.advanceRaysAll += advanceAll.rays;
        totals.advanceRoutesNow += advanceNow.routes;
        totals.advanceRoutesAll += advanceAll.routes;
        totals.fleeNow += fleeNow.routes;
        totals.fleeAll += fleeAll.routes;
        if (advanceExpected) totals.advances++;
        if (fleeExpected) totals.flees++;
      }
    } finally {
      navigation.findPath = findPath;
      level.collision.rayDistance = rayDistance;
    }
    expect(totals.advances).toBeGreaterThan(30); // enough cases with a spot for the comparison to mean something
    expect(totals.flees).toBeGreaterThan(100);
    // Moving up's cost is mostly how much of each route is in view, which nothing cheap can tell in advance: it still
    // searches most routes, but stops measuring a route once it has lost, which saves most of the rays.
    expect(totals.advanceRoutesNow).toBeLessThanOrEqual(totals.advanceRoutesAll);
    expect(totals.advanceRaysNow).toBeLessThan(totals.advanceRaysAll * 0.6);
    expect(totals.fleeNow).toBeLessThan(totals.fleeAll / 3);
    console.log(`4.13b counts over 150 cases: moving up ${totals.advanceRoutesAll} to ${totals.advanceRoutesNow} routes, ${totals.advanceRaysAll} to ${totals.advanceRaysNow} rays; fleeing ${totals.fleeAll} to ${totals.fleeNow} routes`);
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
