import { Vector3 } from 'three';
import { coverConfig } from '../config/cover';
import { dummyConfig } from '../config/dummy';
import { standInConfig } from '../config/standInEnemy';
import type { LevelCollision } from './collision';

/** A spot behind cover, placed by hand in the level data (level.md, "Cover points"). */
export interface CoverPoint {
  /** Where an enemy's feet go. */
  readonly xM: number;
  readonly zM: number;
  /** Low cover hides a crouched body; high cover hides a standing one. */
  readonly height: 'low' | 'high';
  /** Points from the spot toward the cover: the direction it protects from. 0 = north (-z), like the player's yaw. */
  readonly facingYawRad: number;
  /** Which sides a peek can step out from, as seen facing the cover (4.4; low cover too since decision 216). */
  readonly lean?: 'left' | 'right' | 'both';
}

/** Something that can claim a spot (an enemy). */
type Owner = object;

// The cover service (architecture.md, "Cover points"): is a spot hidden from a threat, which spots are taken, and the best
// free spot against a threat. "Hidden" is decided by rays through the level between the threat's eyes and where a body's
// head and chest would be at the spot (crouched for low cover, standing for high), so it always matches the real props.
// Only the spot's own prop counts: something far from the spot, such as the cover Rook hides behind, does not make it a
// hiding place (it would put the enemy on the wrong side of its own cover).
export class CoverPoints {
  private readonly claims = new Map<CoverPoint, Owner>();
  private readonly target = new Vector3();
  private readonly direction = new Vector3();

  constructor(
    readonly points: readonly CoverPoint[],
    private readonly collision: LevelCollision,
  ) {}

  /** True if the lines from the head and the chest of a body at this spot toward `eyes` are both blocked by the spot's own prop. */
  hides(point: CoverPoint, eyes: Vector3): boolean {
    const bodyHeightM = point.height === 'low' ? standInConfig.crouchHeightM : dummyConfig.heightM;
    this.target.set(point.xM, bodyHeightM - dummyConfig.headRadiusM, point.zM);
    if (!this.blockedNearby(this.target, eyes)) return false;
    this.target.y = bodyHeightM * coverConfig.chestShareOfHeight;
    return this.blockedNearby(this.target, eyes);
  }

  /** Who holds this spot, or null if it is free. */
  claimedBy(point: CoverPoint): Owner | null {
    return this.claims.get(point) ?? null;
  }

  /** Lets go of whatever spot `owner` holds. */
  release(owner: Owner): void {
    for (const [point, holder] of this.claims) if (holder === owner) this.claims.delete(point);
  }

  /**
   * The best spot for `owner` against a threat whose eyes are at `eyes` and feet at `feet`, or null if none hides it.
   * The spot must hide it and not be held by anyone else; then it should be in the liked range from the threat, and a
   * short walk (`walkM` gives the walking distance to a spot, Infinity if it cannot be reached). The winner is claimed
   * for `owner`, and any spot it held before is let go.
   */
  best(owner: Owner, eyes: Vector3, feet: Vector3, walkM: (point: CoverPoint) => number): CoverPoint | null {
    let best: CoverPoint | null = null;
    let bestScore = -Infinity;
    for (const point of this.points) {
      const holder = this.claims.get(point);
      if (holder && holder !== owner) continue;
      if (!this.hides(point, eyes)) continue;
      const fromThreatM = Math.hypot(point.xM - feet.x, point.zM - feet.z);
      const outOfRangeM = Math.max(coverConfig.preferMinM - fromThreatM, fromThreatM - coverConfig.preferMaxM, 0);
      const walk = walkM(point);
      if (!Number.isFinite(walk)) continue;
      const score = -(outOfRangeM * coverConfig.rangePenaltyPerM + walk * coverConfig.walkPenaltyPerM);
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    this.release(owner);
    if (best) this.claims.set(best, owner);
    return best;
  }

  /** Claims `point` for `owner`, letting go of any spot it held before. */
  claim(point: CoverPoint, owner: Owner): void {
    this.release(owner);
    this.claims.set(point, owner);
  }

  /** Clears every claim (instant restart). */
  clearClaims(): void {
    this.claims.clear();
  }

  /** True if the line from `body` toward `eyes` hits something within the own-cover reach of `body`: its own prop. */
  private blockedNearby(body: Vector3, eyes: Vector3): boolean {
    const distanceM = body.distanceTo(eyes);
    this.direction.subVectors(eyes, body).divideScalar(distanceM);
    return this.collision.rayDistance(body, this.direction, Math.min(distanceM, coverConfig.ownCoverReachM)) !== Infinity;
  }
}
