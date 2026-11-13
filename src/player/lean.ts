// Lean maths, with no browser or three.js code so it can be tested.
// Offsets are sideways distances from the body: positive is right, negative is left.

/** Wanted lean direction: -1 left (Q), +1 right (E). Both held cancel out; not allowed gives 0. */
export function wantedLean(leftHeld: boolean, rightHeld: boolean, allowed: boolean): -1 | 0 | 1 {
  if (!allowed) return 0;
  return ((rightHeld ? 1 : 0) - (leftHeld ? 1 : 0)) as -1 | 0 | 1;
}

/**
 * Stops a lean from reaching into a wall. `directionSign` is the side being checked, `hitDistanceM` is how far
 * away the first wall is on that side (Infinity if none). Offsets on the other side are left alone.
 */
export function limitLean(offsetM: number, directionSign: number, hitDistanceM: number, clearanceM: number): number {
  if (directionSign === 0) return offsetM;
  const allowedM = Math.max(0, hitDistanceM - clearanceM);
  return offsetM * directionSign > allowedM ? directionSign * allowedM : offsetM;
}

/** Eases `current` toward `target` with a time constant, so it looks smooth and does not depend on frame rate. */
export function easeToward(current: number, target: number, dtSec: number, timeConstantSec: number): number {
  return current + (target - current) * (1 - Math.exp(-dtSec / timeConstantSec));
}

/** Camera tilt for a lean offset: leaning right tilts clockwise, which is a negative roll in three.js. */
export function rollForLean(offsetM: number, fullLeanM: number, fullRollRad: number): number {
  return (-offsetM / fullLeanM) * fullRollRad;
}
