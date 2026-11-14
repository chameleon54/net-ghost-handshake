import type { CoverPoint } from '../level/cover';

// The cover points in the grey-box room (milestones 4.3 and 4.4, decisions 206 and 211), placed by hand. The level data
// format and the in-game editor (5.2) take these over. Each spot is 0.45 m from the face of its prop, so an enemy's body
// (0.3 m radius) fits and the spot is on the navigation mesh. `facingYawRad` points from the spot toward the cover
// (0 = north, -z; pi = south; -pi/2 = east, +x; pi/2 = west). Low cover hides a crouched body, and a peek rises over it.
// High cover hides a standing body, and a peek steps sideways past an edge: `lean` says which sides are open, as seen
// facing the cover. A high spot sits 0.3 m inside its wall's end, so the 0.6 m step clears the edge.
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
  // Pillar (x 0, z 0, 2.2 m, 0.6 m wide): narrow enough to step out on either side.
  { xM: 0, zM: -0.75, height: 'high', facingYawRad: south, lean: 'both' },
  { xM: 0, zM: 0.75, height: 'high', facingYawRad: north, lean: 'both' },
  { xM: 0.75, zM: 0, height: 'high', facingYawRad: west, lean: 'both' },
  { xM: -0.75, zM: 0, height: 'high', facingYawRad: east, lean: 'both' },
  // Long bench (x -2.5, z 3, 1 m): two spots on each long side.
  { xM: -3.5, zM: 2.25, height: 'low', facingYawRad: south },
  { xM: -1.5, zM: 2.25, height: 'low', facingYawRad: south },
  { xM: -3.5, zM: 3.75, height: 'low', facingYawRad: north },
  { xM: -1.5, zM: 3.75, height: 'low', facingYawRad: north },
  // L-shaped wall (2.5 m): the arm along x at z 2 (ends at x 3.5 and 6.5), and the arm along z at x 6.4 (ends at z 2 and 5).
  // Outside and inside of each, near the open ends.
  { xM: 3.8, zM: 1.45, height: 'high', facingYawRad: south, lean: 'right' }, // right of facing south is west
  { xM: 3.8, zM: 2.55, height: 'high', facingYawRad: north, lean: 'left' }, // left of facing north is west
  { xM: 6.95, zM: 4.7, height: 'high', facingYawRad: west, lean: 'left' }, // left of facing west is south
  { xM: 5.85, zM: 4.7, height: 'high', facingYawRad: east, lean: 'right' }, // right of facing east is south
  // Peek-corner partition (x -8 to -5.5, z 1.5, 2.4 m): near its open east end.
  { xM: -5.8, zM: 0.9, height: 'high', facingYawRad: south, lean: 'left' }, // left of facing south is east
  { xM: -5.8, zM: 2.1, height: 'high', facingYawRad: north, lean: 'right' }, // right of facing north is east
  // 1.9 m platform (x -3 to -1, z -5 to -3): taller than a standing body. Near its southern corners.
  { xM: -1.4, zM: -2.55, height: 'high', facingYawRad: north, lean: 'right' }, // steps east
  { xM: -0.55, zM: -3.4, height: 'high', facingYawRad: west, lean: 'left' }, // steps south
  { xM: -3.45, zM: -3.45, height: 'high', facingYawRad: east, lean: 'right' }, // steps south
];
