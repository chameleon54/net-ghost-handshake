// The gun's ammunition: the magazine in the gun, a round in the chamber, and the pouch of spare magazines.
// Ammo is counted in magazines, not bullets (see weapons.md). No drawing code here.
//
// A shot fires the chambered round and the next one feeds from the magazine. Reloading with rounds left keeps the
// chambered round, so the gun then holds a full magazine plus one. Reloading an empty gun has an empty chamber: the
// rack chambers a round from the new magazine.
export class Magazines {
  /** Rounds in the magazine that is in the gun (not counting the chambered round). */
  magRounds: number;
  /** True while a round is in the chamber. Only false when the gun is empty. */
  chambered: boolean;
  /** Rounds in each spare magazine. Never holds an empty one: empty magazines are dropped. */
  private readonly pouch: number[];

  /** Start with `count` full magazines, one of them in the gun, and a round chambered. */
  constructor(
    readonly capacityRounds: number,
    count: number,
  ) {
    this.chambered = count > 0;
    this.magRounds = count > 0 ? capacityRounds : 0;
    this.pouch = Array.from({ length: Math.max(count - 1, 0) }, () => capacityRounds);
  }

  /** Rounds ready to fire: the magazine plus the chambered round. */
  get loadedRounds(): number {
    return this.magRounds + (this.chambered ? 1 : 0);
  }

  /** Spare magazines in the pouch (not counting the one in the gun). */
  get spareCount(): number {
    return this.pouch.length;
  }

  /** Every round carried: gun, chamber and spares. For tests and checks. */
  get totalRounds(): number {
    return this.pouch.reduce((sum, rounds) => sum + rounds, this.loadedRounds);
  }

  /** True if the fullest spare has more rounds than the magazine in the gun, so a reload would help. */
  get canReload(): boolean {
    const fullest = this.fullestIndex();
    return fullest >= 0 && this.pouch[fullest] > this.magRounds;
  }

  /** Fires one round. Returns false if the gun is empty. The next round, if any, feeds into the chamber. */
  takeRound(): boolean {
    if (!this.chambered) return false;
    if (this.magRounds > 0) this.magRounds -= 1;
    else this.chambered = false;
    return true;
  }

  /**
   * Puts the gun's magazine back in the pouch as it is (unless empty) and loads the fullest spare. An empty gun
   * then racks, which chambers a round from the new magazine. Returns false if there is nothing better to load.
   */
  reload(): boolean {
    if (!this.canReload) return false;
    const [fullest] = this.pouch.splice(this.fullestIndex(), 1);
    if (this.magRounds > 0) this.pouch.push(this.magRounds);
    this.magRounds = fullest;
    if (!this.chambered) {
      this.chambered = true;
      this.magRounds -= 1;
    }
    return true;
  }

  private fullestIndex(): number {
    let best = -1;
    this.pouch.forEach((rounds, index) => {
      if (best < 0 || rounds > this.pouch[best]) best = index;
    });
    return best;
  }
}
