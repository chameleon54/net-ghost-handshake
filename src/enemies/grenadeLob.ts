import { Vector3 } from 'three';
import { createRayHit, type LevelCollision } from '../level/collision';

// How an enemy lobs a grenade (milestone 4.12, decision 249): the throw speed that lands it on a point for a given throw
// angle, and a check that nothing is in the way along the flight. Plain maths and ray tests, no drawing.

/** The flight is checked in steps this long (short enough that a step never jumps past a thin prop). */
const flightStepSec = 0.03;
/** The flight is followed at most this many times as long as it should take, in case it never strikes anything. */
const flightOvershoot = 1.5;

const step = new Vector3();
const a = new Vector3();
const b = new Vector3();
const hit = createRayHit();

/**
 * The velocity, into `out`, that throws from `from` at `angleRad` above level and lands on `to` under `gravityMps2`.
 * False if no throw at that angle can reach it (too steep a climb for that angle, or `to` straight above or below).
 */
export function lobVelocity(from: Vector3, to: Vector3, angleRad: number, gravityMps2: number, out: Vector3): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distanceM = Math.hypot(dx, dz);
  const riseM = to.y - from.y;
  const cos = Math.cos(angleRad);
  // From the flight equations: rise = d tan(angle) - g d² / (2 v² cos²(angle)), solved for the speed v.
  const below = 2 * cos * cos * (distanceM * Math.tan(angleRad) - riseM);
  if (distanceM < 1e-3 || below <= 0) return false;
  const speedMps = Math.sqrt((gravityMps2 * distanceM * distanceM) / below);
  const level = speedMps * cos;
  out.set((dx / distanceM) * level, speedMps * Math.sin(angleRad), (dz / distanceM) * level);
  return true;
}

/**
 * True if a grenade thrown from `from` at `velocity` reaches `to` without striking anything on the way: the first thing
 * it strikes must be within `toleranceM` of `to` (the floor there, or the back of his cover). Nothing struck at all also
 * counts as clear.
 */
export function lobIsClear(
  from: Vector3,
  velocity: Vector3,
  to: Vector3,
  gravityMps2: number,
  collision: LevelCollision,
  toleranceM: number,
): boolean {
  const levelSpeedMps = Math.hypot(velocity.x, velocity.z);
  if (levelSpeedMps < 1e-3) return false;
  const flightSec = (Math.hypot(to.x - from.x, to.z - from.z) / levelSpeedMps) * flightOvershoot;
  a.copy(from);
  for (let t = flightStepSec; t <= flightSec + flightStepSec; t += flightStepSec) {
    b.copy(from).addScaledVector(velocity, t);
    b.y -= 0.5 * gravityMps2 * t * t;
    step.subVectors(b, a);
    const lengthM = step.length();
    if (lengthM > 1e-6 && collision.raycast(a, step.divideScalar(lengthM), lengthM, hit)) {
      return hit.point.distanceTo(to) <= toleranceM;
    }
    a.copy(b);
  }
  return true;
}
