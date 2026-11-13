// Walking maths, with no browser or three.js code so it can be tested.
// Coordinates: x is right, z is toward the viewer; yaw 0 faces -z, and a positive yaw turns left.

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * The direction the player wants to move, in world space, with length 0 or 1.
 * `forward` and `right` are -1, 0 or 1 (W minus S, D minus A). Diagonals are normalised so
 * they are not faster than straight lines.
 */
export function wishDirection(forward: number, right: number, yawRad: number, out: Vec2): Vec2 {
  const sin = Math.sin(yawRad);
  const cos = Math.cos(yawRad);
  // forward is (-sin, -cos); right is (cos, -sin)
  const x = -sin * forward + cos * right;
  const z = -cos * forward - sin * right;
  const length = Math.hypot(x, z);
  if (length > 1) {
    out.x = x / length;
    out.z = z / length;
  } else {
    out.x = x;
    out.z = z;
  }
  return out;
}

/** Moves `velocity` toward the wanted speed, building up when a key is held and braking when not. */
export function accelerate(
  velocity: Vec2,
  wish: Vec2,
  maxSpeedMps: number,
  accelerationMps2: number,
  brakingMps2: number,
  dtSec: number,
): void {
  const targetX = wish.x * maxSpeedMps;
  const targetZ = wish.z * maxSpeedMps;
  const diffX = targetX - velocity.x;
  const diffZ = targetZ - velocity.z;
  const diffLength = Math.hypot(diffX, diffZ);

  const holdingKey = wish.x !== 0 || wish.z !== 0;
  const maxChange = (holdingKey ? accelerationMps2 : brakingMps2) * dtSec;

  if (diffLength <= maxChange) {
    velocity.x = targetX;
    velocity.z = targetZ;
  } else {
    velocity.x += (diffX / diffLength) * maxChange;
    velocity.z += (diffZ / diffLength) * maxChange;
  }
}

/**
 * Turns the unit direction `dir` toward the wanted direction by at most `maxTurnRad`.
 * Does nothing when no key is held. Used for the slight steer during a slide.
 */
export function steerToward(dir: Vec2, wish: Vec2, maxTurnRad: number): void {
  if (wish.x === 0 && wish.z === 0) return;
  const current = Math.atan2(dir.z, dir.x);
  const wanted = Math.atan2(wish.z, wish.x);
  // Shortest way round, in the range -PI to PI.
  let diff = wanted - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const turn = Math.max(-maxTurnRad, Math.min(maxTurnRad, diff));
  dir.x = Math.cos(current + turn);
  dir.z = Math.sin(current + turn);
}
