import { describe, expect, it } from 'vitest';
import { accelerate, wishDirection } from '../src/player/movement';

describe('wishDirection', () => {
  it('forward at yaw 0 points toward -z', () => {
    const out = wishDirection(1, 0, 0, { x: 0, z: 0 });
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-1);
  });

  it('right at yaw 0 points toward +x', () => {
    const out = wishDirection(0, 1, 0, { x: 0, z: 0 });
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
  });

  it('turning left by 90 degrees makes forward point toward -x', () => {
    const out = wishDirection(1, 0, Math.PI / 2, { x: 0, z: 0 });
    expect(out.x).toBeCloseTo(-1);
    expect(out.z).toBeCloseTo(0);
  });

  it('is zero with no keys held', () => {
    const out = wishDirection(0, 0, 1.234, { x: 9, z: 9 });
    expect(Math.hypot(out.x, out.z)).toBe(0);
  });

  it('diagonals are not faster than straight lines', () => {
    const out = wishDirection(1, 1, 0.7, { x: 0, z: 0 });
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
  });
});

describe('accelerate', () => {
  it('builds speed gradually and stops at the maximum', () => {
    const velocity = { x: 0, z: 0 };
    accelerate(velocity, { x: 1, z: 0 }, 4, 40, 60, 0.05);
    expect(velocity.x).toBeCloseTo(2);
    accelerate(velocity, { x: 1, z: 0 }, 4, 40, 60, 0.05);
    accelerate(velocity, { x: 1, z: 0 }, 4, 40, 60, 0.05);
    expect(velocity.x).toBeCloseTo(4);
  });

  it('brakes to a stop when no key is held, without overshooting', () => {
    const velocity = { x: 4, z: 0 };
    accelerate(velocity, { x: 0, z: 0 }, 4, 40, 60, 0.05);
    expect(velocity.x).toBeCloseTo(1);
    accelerate(velocity, { x: 0, z: 0 }, 4, 40, 60, 0.05);
    expect(velocity.x).toBe(0);
  });
});
