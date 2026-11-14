import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { greyboxRoom, type RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';

// These run the real navigation library on the real test room.
let navigation: Navigation;
beforeAll(async () => {
  navigation = await Navigation.create(buildGreybox().navigationGeometry);
});

/** True if (x, z) is inside a box's footprint grown by `marginM`. Every box blocks walking: props are not climbed, and the beam is too low. */
const insideBox = (box: RoomBox, x: number, z: number, marginM: number): boolean =>
  Math.abs(x - box.xM) < box.widthM / 2 + marginM && Math.abs(z - box.zM) < box.depthM / 2 + marginM;

/** The first box any part of the path passes through (checked every 5 cm), grown by a margin a little under the body's radius. */
function boxCrossedBy(path: Vector3[], marginM = 0.15): RoomBox | null {
  const point = new Vector3();
  for (let i = 1; i < path.length; i++) {
    const steps = Math.ceil(path[i - 1].distanceTo(path[i]) / 0.05);
    for (let s = 0; s <= steps; s++) {
      point.lerpVectors(path[i - 1], path[i], s / steps);
      const crossed = greyboxRoom.find((box) => insideBox(box, point.x, point.z, marginM));
      if (crossed) return crossed;
    }
  }
  return null;
}

describe('Navigation on the test room', () => {
  it('builds a mesh, and no floor inside or under a prop can be reached', () => {
    // A prop taller than an enemy is hollow to the library, so the floor sealed inside it (the 1.9 m platform) becomes a
    // patch of its own. Nothing can get in: a path to it stops on the open floor outside.
    const [positions] = navigation.triangles();
    expect(positions.length).toBeGreaterThan(0);
    const path: Vector3[] = [];
    const point = new Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 1] > 0.2) continue; // the tops of props are patches of their own too
      point.set(positions[i], 0, positions[i + 2]);
      if (!greyboxRoom.some((b) => insideBox(b, point.x, point.z, 0.15))) continue;
      expect(navigation.findPath(new Vector3(0, 0, 4), point, path)).toBe(true);
      expect(boxCrossedBy(path), `a path into the prop at ${point.x}, ${point.z}`).toBeNull();
    }
  });

  it('ends on the floor beside the platform when the target stands on it', () => {
    const path: Vector3[] = [];
    expect(navigation.findPath(new Vector3(0, 0, 4), new Vector3(-2, 1.9, -4), path)).toBe(true);
    expect(path[path.length - 1].y).toBeLessThan(0.2);
    expect(boxCrossedBy(path)).toBeNull();
  });

  it('goes around the pillar instead of through it', () => {
    const path: Vector3[] = [];
    expect(navigation.findPath(new Vector3(0, 0, -2), new Vector3(0, 0, 2), path)).toBe(true);
    expect(path.length).toBeGreaterThan(2);
    expect(boxCrossedBy(path)).toBeNull();
    expect(path[0].distanceTo(new Vector3(0, 0, -2))).toBeLessThan(0.1);
    expect(path[path.length - 1].distanceTo(new Vector3(0, 0, 2))).toBeLessThan(0.1);
  });

  it('reaches into the corner of the L-shaped wall from the far side of it', () => {
    const path: Vector3[] = [];
    expect(navigation.findPath(new Vector3(6, 0, -1), new Vector3(5.8, 0, 2.6), path)).toBe(true);
    expect(boxCrossedBy(path)).toBeNull();
    expect(path[path.length - 1].distanceTo(new Vector3(5.8, 0, 2.6))).toBeLessThan(0.1);
  });

  it('ends on the floor beside a crate when the target stands on top of it', () => {
    const path: Vector3[] = [];
    expect(navigation.findPath(new Vector3(0, 0, 4), new Vector3(-4, 1, -2), path)).toBe(true); // the low crate
    const end = path[path.length - 1];
    expect(end.y).toBeLessThan(0.2);
    expect(Math.hypot(end.x - -4, end.z - -2)).toBeLessThan(1.2); // half the crate plus the body's radius, and a little
    expect(boxCrossedBy(path)).toBeNull();
  });

  it('finds no path to a point far outside the room', () => {
    const path: Vector3[] = [new Vector3()];
    expect(navigation.findPath(new Vector3(0, 0, 4), new Vector3(0, 0, -30), path)).toBe(false);
    expect(path).toHaveLength(0);
  });

  it('gives the nearest walkable floor to a point inside a prop', () => {
    const out = new Vector3();
    expect(navigation.closestPoint(new Vector3(3, 0, -3), out)).toBe(true); // inside the tall crate
    expect(insideBox(greyboxRoom[5], out.x, out.z, 0.15)).toBe(false);
    expect(Math.hypot(out.x - 3, out.z - -3)).toBeLessThan(1.3);
  });
});
