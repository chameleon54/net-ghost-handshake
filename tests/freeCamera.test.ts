import { describe, expect, it } from 'vitest';
import { flyVelocity } from '../src/debug/freeCamera';

const out = () => ({ x: 0, y: 0, z: 0 });

describe('flyVelocity', () => {
  it('forward at yaw 0 and pitch 0 goes toward -z at the given speed', () => {
    const v = flyVelocity(1, 0, 0, 0, 0, 6, out());
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-6);
  });

  it('forward while looking up also climbs, and while looking straight up goes straight up', () => {
    expect(flyVelocity(1, 0, 0, 0, Math.PI / 4, 6, out()).y).toBeGreaterThan(0);
    const straightUp = flyVelocity(1, 0, 0, 0, Math.PI / 2, 6, out());
    expect(straightUp.y).toBeCloseTo(6);
    expect(Math.abs(straightUp.z)).toBeLessThan(1e-9);
  });

  it('right is sideways and level, whatever the pitch, and turns with the yaw', () => {
    const right = flyVelocity(0, 1, 0, 0, 1, 6, out());
    expect(right.x).toBeCloseTo(6);
    expect(right.y).toBeCloseTo(0);
    const turnedLeft = flyVelocity(0, 1, 0, Math.PI / 2, 0, 6, out());
    expect(turnedLeft.z).toBeCloseTo(-6); // after turning left 90 degrees, right points toward -z
  });

  it('up goes straight up in the world, whichever way you look', () => {
    const v = flyVelocity(0, 0, 1, 1.2, 0.7, 6, out());
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(6);
    expect(v.z).toBeCloseTo(0);
  });

  it('combined keys are not faster than one key', () => {
    const v = flyVelocity(1, 1, 1, 0.4, 0.3, 6, out());
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(6);
  });

  it('no keys means no movement', () => {
    const v = flyVelocity(0, 0, 0, 0.4, 0.3, 6, out());
    expect(Math.hypot(v.x, v.y, v.z)).toBe(0);
  });
});
