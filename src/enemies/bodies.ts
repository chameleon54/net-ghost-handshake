import type { Vector3 } from 'three';

// Enemies' bodies against each other (4.16, decision 266): they keep apart instead of walking through each other, and
// a body in the line of fire blocks a squadmate's round. Plain geometry on the floor plan, tested without rendering.

/** What keeping apart needs to know of an enemy. */
export interface SpacedBody {
  readonly feet: Vector3;
  /** Holding its spot (in cover, or standing): it is not pushed; a moving one steps aside instead. */
  readonly fixed: boolean;
}

/**
 * Pushes apart any two bodies whose centres are closer than `minGapM` (two body radii: they may touch, never overlap).
 * A moving one steps aside from a fixed one by the whole overlap; two moving ones share it; two fixed ones stay (a
 * moment's brush during a side peek). Writes the ones it moved into `moved` (cleared first). One pass per update.
 */
export function keepApart<T extends SpacedBody>(bodies: readonly T[], minGapM: number, moved: T[]): void {
  moved.length = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (a.fixed && b.fixed) continue;
      const dx = b.feet.x - a.feet.x;
      const dz = b.feet.z - a.feet.z;
      const apartM = Math.hypot(dx, dz);
      if (apartM >= minGapM) continue;
      const overlapM = minGapM - apartM;
      const awayX = apartM > 1e-6 ? dx / apartM : 1; // exactly on top of each other: part them along x
      const awayZ = apartM > 1e-6 ? dz / apartM : 0;
      const shareA = a.fixed ? 0 : b.fixed ? 1 : 0.5;
      const shareB = 1 - shareA;
      a.feet.x -= awayX * overlapM * shareA;
      a.feet.z -= awayZ * overlapM * shareA;
      b.feet.x += awayX * overlapM * shareB;
      b.feet.z += awayZ * overlapM * shareB;
      if (shareA > 0 && !moved.includes(a)) moved.push(a);
      if (shareB > 0 && !moved.includes(b)) moved.push(b);
    }
  }
}

/**
 * True if the line from `from` to `to` passes within `reachM` of the upright body standing at (x, z), `heightM` tall,
 * between the two ends (a body behind the target or behind the shooter does not count).
 */
export function bodyInLine(from: Vector3, to: Vector3, x: number, z: number, heightM: number, reachM: number): boolean {
  const lineX = to.x - from.x;
  const lineZ = to.z - from.z;
  const lengthSq = lineX * lineX + lineZ * lineZ;
  if (lengthSq < 1e-9) return false;
  const along = ((x - from.x) * lineX + (z - from.z) * lineZ) / lengthSq; // 0 at the shooter, 1 at the target
  if (along <= 0 || along >= 1) return false;
  const offM = Math.hypot(from.x + lineX * along - x, from.z + lineZ * along - z);
  if (offM > reachM) return false;
  const lineY = from.y + (to.y - from.y) * along; // the round's height where it passes the body
  return lineY >= 0 && lineY <= heightM;
}
