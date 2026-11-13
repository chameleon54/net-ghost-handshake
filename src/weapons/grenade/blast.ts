import { Vector3 } from 'three';
import { grenadeConfig } from '../../config/grenade';
import { createRayHit, type LevelCollision } from '../../level/collision';

/** Anything a blast can hurt: a dummy now, enemies later, and Rook. */
export interface BlastTarget {
  /** Where the blast aims: the target's chest. */
  chest(out: Vector3): Vector3;
  /** False for a target that is already out of the fight (falling, lying down, dead). */
  vulnerable(): boolean;
  /** Takes the damage. */
  hurt(damage: number): void;
}

/** Damage at a distance from the centre: full at the centre, falling in a straight line to the edge value at the edge, none beyond. */
export function blastDamageAt(distanceM: number): number {
  if (distanceM >= grenadeConfig.blastRadiusM) return 0;
  const share = Math.max(distanceM, 0) / grenadeConfig.blastRadiusM;
  return grenadeConfig.damageAtCentre + (grenadeConfig.damageAtEdge - grenadeConfig.damageAtCentre) * share;
}

const chest = new Vector3();
const toTarget = new Vector3();
const start = new Vector3();
const hit = createRayHit();
const clearanceM = 0.3; // a wall right at the target does not count as between: it is the surface the target stands against

/** True if something solid (a wall, a prop) is between the blast and the point: cover protects. */
export function isShielded(origin: Vector3, point: Vector3, collision: LevelCollision): boolean {
  start.copy(origin);
  start.y += grenadeConfig.blastLiftM; // taken from just above the ground, so the floor under the grenade is not "in the way"
  toTarget.copy(point).sub(start);
  const distanceM = toTarget.length();
  if (distanceM < 1e-6) return false;
  toTarget.divideScalar(distanceM);
  return collision.raycast(start, toTarget, distanceM - clearanceM, hit);
}

/** What one target took, for tests and for the readouts. */
export interface BlastResult {
  target: BlastTarget;
  distanceM: number;
  damage: number;
}

/**
 * Works out a blast at `origin`: every vulnerable target within the radius and not shielded by cover takes the damage for its
 * distance. Returns what each one took (targets that took nothing are left out).
 */
export function resolveBlast(origin: Vector3, collision: LevelCollision, targets: readonly BlastTarget[]): BlastResult[] {
  const results: BlastResult[] = [];
  for (const target of targets) {
    if (!target.vulnerable()) continue;
    target.chest(chest);
    const distanceM = chest.distanceTo(origin);
    const damage = blastDamageAt(distanceM);
    if (damage <= 0 || isShielded(origin, chest, collision)) continue;
    target.hurt(damage);
    results.push({ target, distanceM, damage });
  }
  return results;
}
