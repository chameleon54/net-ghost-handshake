// The storey push (decision 277, owner's playtest of 5.3b): when Rook fights from another floor than part of the squad and
// they only wait below peeking at him, the squad sends one of them up the stairs, covered by a squadmate's fire. This is
// the rule for when and who; the enemy itself walks (it heads for Rook with no cover, and on his floor it picks cover
// there). Plain numbers, tested without rendering.

/** What the push needs to know of an enemy (the stand-ins have these). */
export interface Climber {
  /** Its feet's height. */
  readonly yM: number;
  /** True if it could be sent now (awake, not wounded, not busy with a throw or covering fire, not the heavy). */
  readonly canClimb: boolean;
  /** True while it is already on its way to Rook's floor. */
  readonly isClimbing: boolean;
}

/** One tier's values for the push (aggression.ts). */
export interface StoreyPushTier {
  readonly storeyPush: number;
  readonly storeyPushAfterSec: number;
  readonly storeyPushMax: number;
}

export class StoreyPush {
  private otherFloorSec = 0;
  private gapLeftSec = 0;

  /** Starts counting afresh (a restart, or the squad no longer knows where Rook is). */
  reset(): void {
    this.otherFloorSec = 0;
    this.gapLeftSec = 0;
  }

  /**
   * Once per update. `rookYM` is the height of his feet while the squad knows where he is, else null. `members` are the
   * enemies in the fight (awake, not down). Returns the one to send up now, or null. Someone is sent when part of the squad
   * has been on another floor than Rook's for the tier's time, nobody was sent in the last `gapSec`, and fewer than the
   * tier's maximum are already climbing. `prefer` picks who goes first.
   */
  update<T extends Climber>(
    dtSec: number,
    rookYM: number | null,
    members: readonly T[],
    tier: StoreyPushTier,
    sameFloorM: number,
    gapSec: number,
    prefer: (member: T) => boolean = () => true,
  ): T | null {
    this.gapLeftSec = Math.max(this.gapLeftSec - dtSec, 0);
    if (rookYM === null || tier.storeyPush <= 0) {
      this.otherFloorSec = 0;
      return null;
    }
    const elsewhere = members.filter((m) => Math.abs(m.yM - rookYM) > sameFloorM);
    if (elsewhere.length === 0) {
      this.otherFloorSec = 0;
      return null;
    }
    this.otherFloorSec += dtSec;
    if (this.otherFloorSec < tier.storeyPushAfterSec || this.gapLeftSec > 0) return null;
    if (members.filter((m) => m.isClimbing).length >= tier.storeyPushMax) return null;
    const eligible = elsewhere.filter((m) => m.canClimb && !m.isClimbing);
    const chosen = eligible.find(prefer) ?? eligible[0] ?? null;
    if (chosen) this.gapLeftSec = gapSec;
    return chosen;
  }
}
