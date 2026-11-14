import { Vector3 } from 'three';

const side = new Vector3();
const up = new Vector3();
const worldUp = new Vector3(0, 1, 0);
const worldRight = new Vector3(1, 0, 0);
const nearlyVertical = 0.99;

/**
 * Tilts the unit vector `direction` (in place) by a random angle inside a cone of `spreadRad` around it.
 * `random1` and `random2` are numbers from 0 to 1 (Math.random()). The tilt is uniform over the cone's disc,
 * so shots do not bunch in the middle. A spread of 0 leaves the direction alone.
 */
export function applySpread(direction: Vector3, spreadRad: number, random1: number, random2: number): void {
  if (spreadRad <= 0) return;
  // Two axes at right angles to the direction; the helper axis only matters when looking straight up or down.
  side.crossVectors(direction, Math.abs(direction.y) < nearlyVertical ? worldUp : worldRight).normalize();
  up.crossVectors(direction, side);
  const tiltRad = spreadRad * Math.sqrt(random1);
  const turnRad = random2 * Math.PI * 2;
  direction
    .multiplyScalar(Math.cos(tiltRad))
    .addScaledVector(side, Math.sin(tiltRad) * Math.cos(turnRad))
    .addScaledVector(up, Math.sin(tiltRad) * Math.sin(turnRad))
    .normalize();
}
