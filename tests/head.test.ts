import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { playerConfig } from '../src/config/player';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { HeadPlacer } from '../src/player/head';

// Regression: leaning against a wall and turning used to put the camera 0.07 m from the wall (at about 55 degrees),
// closer than the camera's near plane reaches, so the other side showed through.
const { collision } = buildGreybox(greyboxRoom);
const head = new HeadPlacer(collision);
const eyeHeightM = playerConfig.eyeHeightM;
const radiusM = playerConfig.capsuleRadiusM;

/** Distance from the camera to the nearest wall in any sideways direction. */
function nearestWallM(position: Vector3): number {
  let nearest = Infinity;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
    nearest = Math.min(nearest, collision.rayDistance(position, new Vector3(Math.cos(a), 0, Math.sin(a)), 1));
  }
  return nearest;
}

// Spots with the body pressed against walls, corners and props (every one is a legal place to stand).
const spots: Array<[string, number, number]> = [
  ['west wall', -8 + radiusM, 0],
  ['east wall', 8 - radiusM, 0],
  ['north wall', 0, -6 + radiusM],
  ['south wall', 0, 6 - radiusM],
  ['north-west corner', -8 + radiusM, -6 + radiusM],
  ['inside of the L-shaped wall', 6.0, 2.45],
  ['beside the partition', -6.2, 1.65 + radiusM],
  ['beside the pillar', 0, 0.3 + radiusM],
];

describe('HeadPlacer keeps the camera away from walls', () => {
  for (const [name, x, z] of spots) {
    it(`at ${name}, for every facing and both leans`, () => {
      const out = new Vector3();
      let closest = Infinity;
      for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 36) {
        for (const lean of [playerConfig.leanDistanceM, -playerConfig.leanDistanceM, 0]) {
          head.place(x, z, eyeHeightM, yaw, lean, out);
          closest = Math.min(closest, nearestWallM(out));
        }
      }
      // Small tolerance for the push-out's own rounding.
      expect(closest).toBeGreaterThanOrEqual(playerConfig.cameraClearanceM - 0.01);
    });
  }

  it('lets a full lean through when nothing is near', () => {
    const out = new Vector3();
    const used = head.place(0, 4.5, eyeHeightM, 0, playerConfig.leanDistanceM, out);
    expect(used).toBeCloseTo(playerConfig.leanDistanceM);
    expect(out.x).toBeCloseTo(playerConfig.leanDistanceM);
  });

  it('cuts the lean back, and reports the smaller lean, next to a wall', () => {
    const out = new Vector3();
    // Facing north with the east wall 0.3 m to the right: a right lean must stop short.
    const used = head.place(8 - radiusM, 0, eyeHeightM, 0, playerConfig.leanDistanceM, out);
    expect(used).toBeLessThan(playerConfig.leanDistanceM);
    expect(used).toBeCloseTo(radiusM - playerConfig.cameraClearanceM, 2);
  });
});
