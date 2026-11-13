import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { greyboxRoom, type RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';

const radiusM = 0.3;
const heightM = 1.8;
const iterations = 5;
const dtSec = 1 / 60;

// One wall: x from 1.0 to 1.2, z from -5 to 5, 3 m tall.
const oneWall: RoomBox[] = [{ kind: 'wall', xM: 1.1, zM: 0, widthM: 0.2, depthM: 10, heightM: 3 }];

function walk(boxes: readonly RoomBox[], start: Vector3, vx: number, vz: number, steps: number): Vector3 {
  const { collision } = buildGreybox(boxes);
  const position = start.clone();
  for (let i = 0; i < steps; i++) {
    position.x += vx * dtSec;
    position.z += vz * dtSec;
    collision.pushOut(position, radiusM, heightM, iterations);
  }
  return position;
}

describe('LevelCollision.pushOut', () => {
  it('leaves a player in open space alone', () => {
    const { collision } = buildGreybox(oneWall);
    const position = new Vector3(-2, 0, 0);
    collision.pushOut(position, radiusM, heightM, iterations);
    expect(position.x).toBeCloseTo(-2);
  });

  it('stops a player walking straight into a wall, one radius away from it', () => {
    const position = walk(oneWall, new Vector3(0, 0, 0), 4, 0, 120);
    expect(position.x).toBeCloseTo(1.0 - radiusM, 2);
  });

  it('stops a player moving at slide speed (8 m/s) even at a thin wall', () => {
    const position = walk(oneWall, new Vector3(0, 0, 0), 8, 0, 60);
    expect(position.x).toBeCloseTo(1.0 - radiusM, 2);
  });

  it('stops a crouched or sliding capsule too (shorter height)', () => {
    const { collision } = buildGreybox(oneWall);
    const position = new Vector3(0, 0, 0);
    for (let i = 0; i < 60; i++) {
      position.x += 8 * dtSec;
      collision.pushOut(position, radiusM, 0.9, iterations);
    }
    expect(position.x).toBeCloseTo(1.0 - radiusM, 2);
  });

  it('slides along a wall when walking into it at an angle', () => {
    const position = walk(oneWall, new Vector3(0, 0, 0), 4, 4, 60);
    expect(position.x).toBeCloseTo(1.0 - radiusM, 2);
    expect(position.z).toBeGreaterThan(2); // kept moving along the wall
  });

  it('never ends up inside a wall, however it is approached', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
      const position = walk(greyboxRoom, new Vector3(0, 0, 4.5), Math.cos(angle) * 4, Math.sin(angle) * 4, 300);
      expect(Math.abs(position.x)).toBeLessThan(8 - radiusM + 0.01);
      expect(Math.abs(position.z)).toBeLessThan(6 - radiusM + 0.01);
    }
  });

  it('is blocked by a prop', () => {
    // The pillar is 0.6 m wide at the room centre; walk at it from +z.
    const position = walk(greyboxRoom, new Vector3(0, 0, 3), 0, -4, 120);
    expect(position.z).toBeGreaterThanOrEqual(0.3 + radiusM - 0.01);
  });

  it('does not trap the player in the inside corner of the L-shaped wall', () => {
    // Push diagonally into the corner near x 6.3, z 2.1, then confirm the player can still back out.
    const position = walk(greyboxRoom, new Vector3(5.5, 0, 3.5), 3, -3, 120);
    expect(position.x).toBeLessThan(6.3 - radiusM + 0.01);
    expect(position.z).toBeGreaterThan(2.1 + radiusM - 0.01);

    const { collision } = buildGreybox(greyboxRoom);
    for (let i = 0; i < 60; i++) {
      position.x -= 3 * dtSec;
      position.z += 3 * dtSec;
      collision.pushOut(position, radiusM, heightM, iterations);
    }
    expect(position.x).toBeLessThan(5.5);
    expect(position.z).toBeGreaterThan(3.5);
  });
});
