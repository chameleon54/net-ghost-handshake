import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { playerConfig } from '../src/config/player';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { easeToward, limitLean, rollForLean, wantedLean } from '../src/player/lean';

describe('wantedLean', () => {
  it('E leans right, Q leans left', () => {
    expect(wantedLean(false, true, true)).toBe(1);
    expect(wantedLean(true, false, true)).toBe(-1);
  });

  it('both keys cancel out, and neither gives no lean', () => {
    expect(wantedLean(true, true, true)).toBe(0);
    expect(wantedLean(false, false, true)).toBe(0);
  });

  it('gives no lean when leaning is not allowed (sprinting or sliding)', () => {
    expect(wantedLean(false, true, false)).toBe(0);
  });
});

describe('limitLean', () => {
  it('leaves a lean alone when the wall is far away', () => {
    expect(limitLean(0.45, 1, Infinity, 0.12)).toBe(0.45);
    expect(limitLean(0.45, 1, 0.57, 0.12)).toBeCloseTo(0.45);
  });

  it('stops short of a near wall, keeping the clearance', () => {
    expect(limitLean(0.45, 1, 0.3, 0.12)).toBeCloseTo(0.18);
    expect(limitLean(-0.45, -1, 0.3, 0.12)).toBeCloseTo(-0.18);
  });

  it('allows no lean at all against a wall', () => {
    expect(limitLean(0.45, 1, 0.05, 0.12)).toBe(0);
  });

  it('does not touch an offset on the other side of the body', () => {
    expect(limitLean(-0.3, 1, 0.1, 0.12)).toBe(-0.3);
  });
});

describe('easeToward and rollForLean', () => {
  it('moves toward the target without overshooting, in any frame size', () => {
    const small = easeToward(0, 1, 0.01, 0.05);
    const large = easeToward(0, 1, 1, 0.05);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(1);
    expect(large).toBeLessThanOrEqual(1);
    expect(large).toBeGreaterThan(0.99);
  });

  it('leaning right tilts clockwise (negative roll), left tilts the other way, centre is level', () => {
    expect(rollForLean(0.45, 0.45, 0.175)).toBeCloseTo(-0.175);
    expect(rollForLean(-0.45, 0.45, 0.175)).toBeCloseTo(0.175);
    expect(rollForLean(0, 0.45, 0.175)).toBeCloseTo(0);
  });
});

describe('the peek corner in the test room', () => {
  // Stand south of the partition facing north; the marker is just past its end. See src/data/greyboxRoom.ts.
  const { collision } = buildGreybox(greyboxRoom);
  const stand = { x: -6.2, z: 3.0 };
  const marker = new Vector3(-4.9, 0.5, -0.5);

  /** True if a ray from this eye position to the marker reaches the marker before hitting anything else. */
  function markerVisibleFrom(eye: Vector3): boolean {
    const toMarker = marker.clone().sub(eye);
    const distanceM = toMarker.length();
    const hitM = collision.rayDistance(eye, toMarker.normalize(), distanceM + 1);
    // A hit well short of the marker's centre means something else (the partition) is in the way.
    return hitM >= distanceM - 0.5;
  }

  it('is hidden when standing behind the partition without leaning', () => {
    expect(markerVisibleFrom(new Vector3(stand.x, playerConfig.eyeHeightM, stand.z))).toBe(false);
  });

  it('comes into view at full lean to the right', () => {
    const eye = new Vector3(stand.x + playerConfig.leanDistanceM, playerConfig.eyeHeightM, stand.z);
    expect(markerVisibleFrom(eye)).toBe(true);
  });
});

describe('a lean ray against a wall', () => {
  it('finds the wall at the expected distance, so the lean can be limited', () => {
    const { collision } = buildGreybox(greyboxRoom);
    // Standing 0.2 m from the west wall's inside face (x = -8), looking at it from the right.
    const origin = new Vector3(-7.8, playerConfig.eyeHeightM, 0);
    const distanceM = collision.rayDistance(origin, new Vector3(-1, 0, 0), 1);
    expect(distanceM).toBeCloseTo(0.2, 2);
    expect(limitLean(-0.45, -1, distanceM, playerConfig.leanHeadClearanceM)).toBeCloseTo(-0.08, 2);
  });

  it('reports no wall when nothing is in range', () => {
    const { collision } = buildGreybox(greyboxRoom);
    expect(collision.rayDistance(new Vector3(0, 1.65, 4), new Vector3(1, 0, 0), 0.5)).toBe(Infinity);
  });
});
