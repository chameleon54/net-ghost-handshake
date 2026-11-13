import { Vector3 } from 'three';
import { playerConfig } from '../config/player';
import type { LevelCollision } from '../level/collision';
import { limitLean } from './lean';

// Works out where the camera (the head) really goes each screen frame, so it can never see through a wall.
// Two layers, because each alone fails:
//  1. A ray along the lean stops the lean short of a wall. It uses the facing of this frame; checking only on
//     the 60 Hz update let the lean point into a wall for a frame while turning.
//  2. A small sphere around the camera is pushed out of walls. The ray's gap is measured along the lean, so at an angle
//     to the wall the real gap shrinks (0.07 m at 55 degrees in testing), less than the camera's near plane reaches.
export class HeadPlacer {
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly sphereFeet = new Vector3();

  constructor(private readonly collision: LevelCollision) {}

  /**
   * `eyeYM` is the camera's height in the world. Writes the camera position into `out` and returns the lean actually used (after the wall limit),
   * which the caller uses for the tilt.
   */
  place(bodyXM: number, bodyZM: number, eyeYM: number, yawRad: number, leanOffsetM: number, out: Vector3): number {
    const { origin, direction, sphereFeet } = this;
    const clearanceM = playerConfig.cameraClearanceM;

    const side = Math.sign(leanOffsetM);
    let leanM = leanOffsetM;
    if (side !== 0) {
      origin.set(bodyXM, eyeYM, bodyZM);
      direction.set(Math.cos(yawRad) * side, 0, -Math.sin(yawRad) * side);
      const wallDistanceM = this.collision.rayDistance(origin, direction, Math.abs(leanOffsetM) + clearanceM);
      leanM = limitLean(leanOffsetM, side, wallDistanceM, clearanceM);
    }

    out.set(bodyXM + Math.cos(yawRad) * leanM, eyeYM, bodyZM - Math.sin(yawRad) * leanM);

    // Final safety: treat the camera as a sphere. pushOut works on a capsule standing on `feet`, so make one as tall as it is wide.
    sphereFeet.set(out.x, eyeYM - clearanceM, out.z);
    this.collision.pushOut(sphereFeet, clearanceM, clearanceM * 2, playerConfig.collisionIterations);
    out.x = sphereFeet.x;
    out.z = sphereFeet.z;

    return leanM;
  }
}
