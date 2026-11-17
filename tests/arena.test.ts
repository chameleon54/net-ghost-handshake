import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { testArena, testArenaDummies, testArenaLayout, testArenaStandIns, testArenaStart } from '../src/data/testArena';
import type { RoomBox } from '../src/data/greyboxRoom';
import { peekEyesAt, StandInEnemy } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import { EventBus } from '../src/core/events';
import { CoverPoints, coverPointsFromBoxes, type CoverPoint } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import type { WeaponEvents } from '../src/weapons/events';
import { squadConfig } from '../src/config/squad';
import { enemyGrenadeConfig } from '../src/config/enemyGrenades';

/** The distance from a spot to the nearest face of its box (on the floor plan), and whether it faces the box. */
const faceGap = (point: CoverPoint, box: RoomBox) => {
  const dx = Math.max(Math.abs(point.xM - box.xM) - box.widthM / 2, 0);
  const dz = Math.max(Math.abs(point.zM - box.zM) - box.depthM / 2, 0);
  const lookX = -Math.sin(point.facingYawRad);
  const lookZ = -Math.cos(point.facingYawRad);
  const facesIt = lookX * (box.xM - point.xM) + lookZ * (box.zM - point.zM) > 0;
  return { gapM: Math.hypot(dx, dz), facesIt };
};

describe('cover points generated from props (decision 236)', () => {
  it('a small low crate: one spot per side, 0.45 m out, facing it, open both ways', () => {
    const crate: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 1, depthM: 1, heightM: 1 };
    const points = coverPointsFromBoxes([crate]);
    expect(points).toHaveLength(4);
    for (const point of points) {
      expect(point.height).toBe('low');
      expect(point.lean).toBe('both');
      const { gapM, facesIt } = faceGap(point, crate);
      expect(gapM).toBeCloseTo(0.45, 5);
      expect(facesIt).toBe(true);
    }
  });

  it('a long low bench: two ends and a middle on its long sides; high cover is high; walls and raised boxes give none', () => {
    const bench: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 3, depthM: 0.8, heightM: 1 };
    expect(coverPointsFromBoxes([bench])).toHaveLength(3 + 3 + 1 + 1);
    const rack: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 0.8, depthM: 3, heightM: 2.4 };
    const rackPoints = coverPointsFromBoxes([rack]);
    expect(rackPoints).toHaveLength(1 + 1 + 2 + 2);
    expect(rackPoints.every((p) => p.height === 'high')).toBe(true);
    const wall: RoomBox = { kind: 'wall', xM: 0, zM: 0, widthM: 3, depthM: 0.3, heightM: 3 };
    const shelf: RoomBox = { kind: 'prop', xM: 0, zM: 0, yM: 1.3, widthM: 3, depthM: 2, heightM: 0.8 };
    expect(coverPointsFromBoxes([wall, shelf])).toHaveLength(0);
  });

  it('a spot near an end opens toward that end: its peek steps out past the edge', () => {
    for (const box of [
      { kind: 'prop', xM: 0, zM: 0, widthM: 0.8, depthM: 3, heightM: 2.4 }, // high: a 0.6 m step
      { kind: 'prop', xM: 0, zM: 0, widthM: 3, depthM: 0.8, heightM: 1 }, // low: a 0.75 m crouched step
    ] satisfies RoomBox[]) {
      for (const point of coverPointsFromBoxes([box])) {
        if (point.lean !== 'left' && point.lean !== 'right') continue;
        const eyes = peekEyesAt(point, point.lean === 'right' ? 1 : -1, new Vector3());
        // Past the box's edge along the side it runs on: its outline no longer covers the step.
        const pastX = Math.abs(eyes.x - box.xM) - box.widthM / 2;
        const pastZ = Math.abs(eyes.z - box.zM) - box.depthM / 2;
        const runsAlongX = Math.abs(Math.abs(point.zM - box.zM) - box.depthM / 2 - 0.45) < 1e-6;
        expect(runsAlongX ? pastX : pastZ, JSON.stringify(point)).toBeGreaterThan(0.2);
      }
    }
  });

  it('a spot inside or against another box is dropped', () => {
    const a: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 1, depthM: 1, heightM: 1 };
    const b: RoomBox = { kind: 'prop', xM: 1.4, zM: 0, widthM: 1, depthM: 1, heightM: 1 }; // 0.4 m gap: no room between
    const points = coverPointsFromBoxes([a, b]);
    expect(points).toHaveLength(6); // each loses the side facing the other
  });
});

describe('the test arena (decision 236)', () => {
  let navigation: Navigation;
  const level = buildGreybox(testArena, testArenaLayout);
  const onMesh = (xM: number, zM: number) => {
    const feet = new Vector3(xM, 0, zM);
    const out = new Vector3();
    return navigation.closestPoint(feet, out) && Math.hypot(out.x - feet.x, out.z - feet.z) < 0.05;
  };
  beforeAll(async () => {
    navigation = await Navigation.create(level.navigationGeometry);
  });

  it('the start, the dummies and the squad spawns are on the navigation mesh', () => {
    expect(onMesh(testArenaStart.xM, testArenaStart.zM)).toBe(true);
    for (const spot of [...testArenaDummies, ...testArenaStandIns]) expect(onMesh(spot.xM, spot.zM), `${spot.xM}, ${spot.zM}`).toBe(true);
  });

  it('plenty of cover spots stand on the mesh, and every one can be walked to from the start', () => {
    const points = coverPointsFromBoxes(testArena).filter((p) => onMesh(p.xM, p.zM));
    expect(points.length).toBeGreaterThan(60);
    const start = new Vector3(testArenaStart.xM, 0, testArenaStart.zM);
    const route: Vector3[] = [];
    for (const point of points) {
      const spot = new Vector3(point.xM, 0, point.zM);
      expect(navigation.findPath(start, spot, route), `${point.xM}, ${point.zM}`).toBe(true);
      expect(route[route.length - 1].distanceTo(spot), `${point.xM}, ${point.zM}`).toBeLessThan(0.25);
    }
  });

  it('every piece of cover can be approached from at least two sides (routes loop, no dead ends)', () => {
    const points = coverPointsFromBoxes(testArena).filter((p) => onMesh(p.xM, p.zM));
    for (const box of testArena.filter((b) => b.kind === 'prop' && !b.yM && b.heightM >= 0.95)) {
      const sides = new Set(points.filter((p) => faceGap(p, box).gapM < 0.5 && faceGap(p, box).facesIt).map((p) => p.facingYawRad));
      expect(sides.size, `${box.xM}, ${box.zM}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('with Rook crouched behind the south-west bench looking north, the flanker has a flank spot and some can move up', () => {
    const cover = new CoverPoints(coverPointsFromBoxes(testArena).filter((p) => onMesh(p.xM, p.zM)), level.collision);
    // From his start, at the back wall, everything is in front of him (like a corner): no flank, by design.
    const rook = {
      position: new Vector3(-6, 0, 7.1),
      eyeHeightNowM: 1,
      eyes: new Vector3(-6, 1, 7.1),
      forward: new Vector3(0, 0, -1),
      inView: () => true,
      exposure: 0,
      movingFast: false,
    };
    const plans = testArenaStandIns.map((spawn) => {
      const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {});
      const enemy = new StandInEnemy(spawn, world);
      return { flank: world.planFlank(enemy), advance: world.planAdvance(enemy) };
    });
    expect(plans[testArenaStandIns.findIndex((s) => s.role === 'flanker')].flank).not.toBeNull();
    expect(plans.some((p) => p.advance !== null)).toBe(true);
  });

  it('with Rook crouched behind the south-west bench, a trooper in cover it picked has a clear lob at him (4.12)', () => {
    const cover = new CoverPoints(coverPointsFromBoxes(testArena).filter((p) => onMesh(p.xM, p.zM)), level.collision);
    const rook = {
      position: new Vector3(-6, 0, 7.1),
      eyeHeightNowM: 1,
      eyes: new Vector3(-6, 1, 7.1),
      forward: new Vector3(0, 0, -1),
      inView: () => true,
      exposure: 0,
      movingFast: false,
    };
    // Every hiding spot within throw range that a trooper could hold: most of them must offer a throw.
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {}, () => [], () => 0.5);
    const enemy = new StandInEnemy(testArenaStandIns[1], world); // the trooper
    const inRange = cover.points.filter((p) => {
      const m = Math.hypot(p.xM - rook.position.x, p.zM - rook.position.z);
      return m >= enemyGrenadeConfig.throwMinM && m <= enemyGrenadeConfig.throwMaxM && cover.hides(p, rook.eyes);
    });
    const withThrow = inRange.filter((p) => world.planThrow(enemy, p) !== null);
    expect(inRange.length).toBeGreaterThan(5);
    expect(withThrow.length / inRange.length).toBeGreaterThan(0.5);
  });

  it('a stand-in picks a spot it can shoot from, and later finds another spot to move on to (decision 237)', () => {
    const cover = new CoverPoints(coverPointsFromBoxes(testArena).filter((p) => onMesh(p.xM, p.zM)), level.collision);
    const rook = {
      position: new Vector3(-6, 0, 7.1),
      eyeHeightNowM: 1,
      eyes: new Vector3(-6, 1, 7.1),
      forward: new Vector3(0, 0, -1),
      inView: () => true,
      exposure: 0,
      movingFast: false,
    };
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {});
    const enemy = new StandInEnemy(testArenaStandIns[1], world); // the trooper
    const spot = world.pickCover(enemy);
    expect(spot).not.toBeNull();
    expect(world.canFightFrom(spot!)).toBe(true);
    enemy.beginReposition(spot!); // it holds that spot now
    const next = world.planReposition(enemy);
    expect(next).not.toBeNull();
    expect(Math.hypot(next!.point.xM - spot!.xM, next!.point.zM - spot!.zM)).toBeGreaterThanOrEqual(squadConfig.repositionMinM - 0.01);
    expect(cover.hides(next!.point, rook.eyes)).toBe(true);
    expect(next!.exposedM).toBeGreaterThanOrEqual(0);
  });
});
