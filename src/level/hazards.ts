import type { HazardPad } from '../data/greyboxRoom';

const padReachM = 0.1; // feet higher than this are on a prop above the pad, not on it

/** True if a player with his feet at (x, y, z) is standing on a hazard pad. */
export function standsOnHazard(x: number, y: number, z: number, pads: readonly HazardPad[]): boolean {
  if (y > padReachM) return false;
  return pads.some((p) => Math.abs(x - p.xM) <= p.widthM / 2 && Math.abs(z - p.zM) <= p.depthM / 2);
}
