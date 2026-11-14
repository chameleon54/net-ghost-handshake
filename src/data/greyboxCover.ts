import type { CoverPoint } from '../level/cover';

// The cover points in the grey-box room (milestone 4.3, decision 206), placed by hand. The level data format and the
// in-game editor (5.2) take these over. Each spot is 0.45 m from the face of its prop, so an enemy's body (0.3 m radius)
// fits and the spot is on the navigation mesh. `facingYawRad` points from the spot toward the cover (0 = north, -z;
// pi = south; -pi/2 = east, +x; pi/2 = west). Low cover hides a crouched body; high cover hides a standing one.
// Lean sides come in 4.4.
const east = -Math.PI / 2;
const west = Math.PI / 2;
const north = 0;
const south = Math.PI;

export const greyboxCover: readonly CoverPoint[] = [
  // Low crate (x -4, z -2, 1 m). The north side is left out: a dummy stands there.
  { xM: -4.95, zM: -2, height: 'low', facingYawRad: east },
  { xM: -3.05, zM: -2, height: 'low', facingYawRad: west },
  { xM: -4, zM: -1.05, height: 'low', facingYawRad: north },
  // Tall crate (x 3, z -3, 1.5 m): hides a crouched body, not a standing one, so it counts as low.
  { xM: 1.95, zM: -3, height: 'low', facingYawRad: east },
  { xM: 4.05, zM: -3, height: 'low', facingYawRad: west },
  { xM: 3, zM: -1.95, height: 'low', facingYawRad: north },
  { xM: 3, zM: -4.05, height: 'low', facingYawRad: south },
  // Pillar (x 0, z 0, 2.2 m).
  { xM: 0, zM: -0.75, height: 'high', facingYawRad: south },
  { xM: 0, zM: 0.75, height: 'high', facingYawRad: north },
  { xM: 0.75, zM: 0, height: 'high', facingYawRad: west },
  { xM: -0.75, zM: 0, height: 'high', facingYawRad: east },
  // Long bench (x -2.5, z 3, 1 m): two spots on each long side.
  { xM: -3.5, zM: 2.25, height: 'low', facingYawRad: south },
  { xM: -1.5, zM: 2.25, height: 'low', facingYawRad: south },
  { xM: -3.5, zM: 3.75, height: 'low', facingYawRad: north },
  { xM: -1.5, zM: 3.75, height: 'low', facingYawRad: north },
  // L-shaped wall (2.5 m): the arm along x at z 2, and the arm along z at x 6.4. Outside and inside of each.
  { xM: 4.5, zM: 1.45, height: 'high', facingYawRad: south },
  { xM: 4.5, zM: 2.55, height: 'high', facingYawRad: north },
  { xM: 6.95, zM: 3.5, height: 'high', facingYawRad: west },
  { xM: 5.85, zM: 4, height: 'high', facingYawRad: east },
  // Peek-corner partition (x -6.75, z 1.5, 2.4 m).
  { xM: -6.25, zM: 0.9, height: 'high', facingYawRad: south },
  { xM: -6.25, zM: 2.1, height: 'high', facingYawRad: north },
  // 1.9 m platform (x -2, z -4): taller than a standing body.
  { xM: -2, zM: -2.55, height: 'high', facingYawRad: north },
  { xM: -0.55, zM: -4, height: 'high', facingYawRad: west },
  { xM: -3.45, zM: -4, height: 'high', facingYawRad: east },
];
