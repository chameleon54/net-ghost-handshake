import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { RoomBox } from '../src/data/greyboxRoom';
import { createRayHit } from '../src/level/collision';
import { buildGreybox } from '../src/level/greybox';

// One wall: x from 4.9 to 5.1, 3 m tall.
const wall: RoomBox[] = [{ kind: 'wall', xM: 5, zM: 0, widthM: 0.2, depthM: 10, heightM: 3 }];
const { collision } = buildGreybox(wall);

describe('LevelCollision.raycast', () => {
  it('reports distance, point and a normal facing the shooter', () => {
    const out = createRayHit();
    expect(collision.raycast(new Vector3(0, 1.5, 0), new Vector3(1, 0, 0), 50, out)).toBe(true);
    expect(out.distanceM).toBeCloseTo(4.9);
    expect(out.point.x).toBeCloseTo(4.9);
    expect(out.normal.x).toBeCloseTo(-1);
  });

  it('misses past the maximum range or into open space', () => {
    const out = createRayHit();
    expect(collision.raycast(new Vector3(0, 1.5, 0), new Vector3(1, 0, 0), 3, out)).toBe(false);
    expect(collision.raycast(new Vector3(0, 1.5, 0), new Vector3(-1, 0, 0), 50, out)).toBe(false);
  });

  it('hits the floor, which is not part of the level geometry', () => {
    const out = createRayHit();
    const down = new Vector3(1, -1, 0).normalize();
    expect(collision.raycast(new Vector3(0, 1.5, 0), down, 50, out)).toBe(true);
    expect(out.point.y).toBeCloseTo(0);
    expect(out.point.x).toBeCloseTo(1.5);
    expect(out.normal.y).toBeCloseTo(1);
  });

  it('prefers a wall that is closer than the floor', () => {
    const out = createRayHit();
    const down = new Vector3(1, -0.1, 0).normalize();
    collision.raycast(new Vector3(0, 1.5, 0), down, 50, out);
    expect(out.point.x).toBeCloseTo(4.9);
  });
});
