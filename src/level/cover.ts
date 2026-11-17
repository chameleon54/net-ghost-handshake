import { Vector3 } from 'three';
import { coverConfig } from '../config/cover';
import { roleConfig } from '../config/roles';
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

/** Cover spots sit this far out from a prop's face (an enemy's body, 0.3 m radius, fits; decision 206). */
const spotOutM = 0.45;
/** A prop this tall or more hides a standing body (high cover); from the crouched height up to it, a crouched one (low). */
const highCoverM = 1.8;
const lowCoverM = 0.95;
/** A high spot sits this far inside its side's end, so a 0.6 m step out clears the edge; a low spot this far (0.75 m step). */
const highEndInsetM = 0.3;
const lowEndInsetM = 0.45;
/** A side this short or less gets one spot in the middle, open both ways; a longer side gets one near each end. */
const highNarrowM = 1;
const lowNarrowM = 1.2;
/** A low side this long or more also gets a spot in the middle, to rise over the top from. */
const lowMiddleFromM = 3;
/** A spot this close to another box's footprint is dropped (it would be inside or against it). */
const clearOfOtherM = 0.35;

/**
 * Cover spots generated from a room's props (decision 236), so a new room needs no hand placing: on each side of each prop
 * standing on the floor (walls left out), 0.45 m out, facing it. Props 1.8 m or taller are high cover (a peek steps past an
 * edge), from 0.95 m low cover (a peek rises, or steps out crouched). A narrow side gets one spot open both ways; a longer
 * side one spot near each end, open toward that end, and a long low side one more in the middle to rise from. Spots inside
 * or against another box are dropped. The caller drops spots that are off the navigation mesh.
 */
export function coverPointsFromBoxes(boxes: readonly { kind: string; xM: number; zM: number; yM?: number; widthM: number; depthM: number; heightM: number }[]): CoverPoint[] {
  const points: CoverPoint[] = [];
  for (const box of boxes) {
    if (box.kind !== 'prop' || (box.yM ?? 0) > 0 || box.heightM < lowCoverM) continue;
    const height: CoverPoint['height'] = box.heightM >= highCoverM ? 'high' : 'low';
    // The four sides: where the spot line runs, which way it faces (toward the box), and the side's length.
    const sides = [
      { outX: 0, outZ: -1, facingYawRad: Math.PI, lengthM: box.widthM }, // north side: the box is to the spot's south
      { outX: 0, outZ: 1, facingYawRad: 0, lengthM: box.widthM },
      { outX: -1, outZ: 0, facingYawRad: -Math.PI / 2, lengthM: box.depthM }, // west side: the box is to its east
      { outX: 1, outZ: 0, facingYawRad: Math.PI / 2, lengthM: box.depthM },
    ];
    for (const side of sides) {
      const centreX = box.xM + side.outX * (box.widthM / 2 + spotOutM);
      const centreZ = box.zM + side.outZ * (box.depthM / 2 + spotOutM);
      const alongX = side.outZ !== 0 ? 1 : 0; // the side runs along x on the north and south, along z on the west and east
      const alongZ = side.outX !== 0 ? 1 : 0;
      const rightX = Math.cos(side.facingYawRad); // the right-hand side when facing the cover (as in peekEyesAt)
      const rightZ = -Math.sin(side.facingYawRad);
      const narrowM = height === 'high' ? highNarrowM : lowNarrowM;
      const insetM = height === 'high' ? highEndInsetM : lowEndInsetM;
      const spots: { offsetM: number; lean?: CoverPoint['lean'] }[] = [];
      if (side.lengthM <= narrowM) {
        spots.push({ offsetM: 0, lean: 'both' });
      } else {
        for (const end of [1, -1]) {
          const offsetM = end * (side.lengthM / 2 - insetM);
          const towardRight = (alongX * rightX + alongZ * rightZ) * end > 0;
          spots.push({ offsetM, lean: towardRight ? 'right' : 'left' });
        }
        if (height === 'low' && side.lengthM >= lowMiddleFromM) spots.push({ offsetM: 0 });
      }
      for (const { offsetM, lean } of spots) {
        const xM = centreX + alongX * offsetM;
        const zM = centreZ + alongZ * offsetM;
        const blocked = boxes.some(
          (other) =>
            other !== box &&
            (other.yM ?? 0) < highCoverM &&
            Math.abs(xM - other.xM) < other.widthM / 2 + clearOfOtherM &&
            Math.abs(zM - other.zM) < other.depthM / 2 + clearOfOtherM,
        );
        if (blocked) continue;
        points.push(lean ? { xM, zM, height, facingYawRad: side.facingYawRad, lean } : { xM, zM, height, facingYawRad: side.facingYawRad });
      }
    }
  }
  return points;
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
  /** `best`'s working list, one entry per spot, reused. */
  private readonly ranked: { point: CoverPoint; index: number; outOfRangeM: number; bound: number }[];

  constructor(
    readonly points: readonly CoverPoint[],
    private readonly collision: LevelCollision,
  ) {
    this.ranked = points.map((point, index) => ({ point, index, outOfRangeM: 0, bound: 0 }));
  }

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
   *
   * Checking a spot is costly (rays for hiding and fighting, a route search for the walk), so it is done in order of
   * promise (4.13b): `minWalkM` says how short the walk to a spot could possibly be (the straight line), which gives each
   * spot the best score it could get; spots are checked best first, and the search stops once no spot left can beat the
   * best one found. The result is the same as checking every spot (ties still go to the spot earlier in the list), as
   * long as `minWalkM` is never more than `walkM`. A test compares it with checking every spot.
   */
  best(
    owner: Owner,
    eyes: Vector3,
    feet: Vector3,
    walkM: (point: CoverPoint) => number,
    /** The liked distance from the threat (the enemy's role). */
    range: { readonly preferMinM: number; readonly preferMaxM: number } = roleConfig.trooper,
    /** True if a peek from the spot can see the threat (a fighting spot, preferred); leave out to treat all alike. */
    fights: (point: CoverPoint) => boolean = () => true,
    /** The shortest the walk to a spot could be; never more than `walkM`. Leave out to check every spot. */
    minWalkM: (point: CoverPoint) => number = () => 0,
  ): CoverPoint | null {
    // Each free spot's best possible score: its range penalty, the shortest possible walk, and no blind-spot penalty.
    const ranked = this.ranked;
    for (const entry of ranked) {
      const { point } = entry;
      const holder = this.claims.get(point);
      if (holder && holder !== owner) {
        entry.bound = -Infinity; // taken: never checked
        continue;
      }
      const fromThreatM = Math.hypot(point.xM - feet.x, point.zM - feet.z);
      entry.outOfRangeM = Math.max(range.preferMinM - fromThreatM, fromThreatM - range.preferMaxM, 0);
      entry.bound = -(entry.outOfRangeM * coverConfig.rangePenaltyPerM + minWalkM(point) * coverConfig.walkPenaltyPerM);
    }
    ranked.sort((a, b) => b.bound - a.bound || a.index - b.index); // most promising first; each entry keeps its index

    let best: CoverPoint | null = null;
    let bestScore = -Infinity;
    let bestIndex = Infinity;
    for (const { point, index, outOfRangeM, bound } of ranked) {
      if (bound === -Infinity || bound < bestScore) break; // no spot left can beat the best one found
      if (bound === bestScore && index > bestIndex) continue; // it could at most tie, and the earlier spot wins ties
      if (!this.hides(point, eyes)) continue;
      const walk = walkM(point);
      if (!Number.isFinite(walk)) continue;
      // Even if it could shoot from here, it would not win: skip the rays that check.
      const scoreIfItFights = -(outOfRangeM * coverConfig.rangePenaltyPerM + walk * coverConfig.walkPenaltyPerM);
      if (scoreIfItFights < bestScore || (scoreIfItFights === bestScore && index > bestIndex)) continue;
      const blind = fights(point) ? 0 : coverConfig.blindSpotPenalty; // a spot it cannot shoot from is a last resort
      const score = -(outOfRangeM * coverConfig.rangePenaltyPerM + walk * coverConfig.walkPenaltyPerM + blind);
      if (score > bestScore || (score === bestScore && index < bestIndex)) {
        bestScore = score;
        bestIndex = index;
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
