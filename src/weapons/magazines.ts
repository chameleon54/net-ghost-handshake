// The magazine pouch. Ammo is counted in magazines, not bullets (see weapons.md). No drawing code here.
export class Magazines {
  /** Rounds in the magazine that is in the gun. */
  loadedRounds: number;
  /** Rounds in each spare magazine. Never holds an empty one: empty magazines are dropped. */
  private readonly pouch: number[];

  /** Start with `count` full magazines, one of them in the gun. */
  constructor(
    readonly capacityRounds: number,
    count: number,
  ) {
    this.loadedRounds = count > 0 ? capacityRounds : 0;
    this.pouch = Array.from({ length: Math.max(count - 1, 0) }, () => capacityRounds);
  }

  /** Spare magazines in the pouch (not counting the one in the gun). */
  get spareCount(): number {
    return this.pouch.length;
  }

  /** Rounds in the spares plus the gun. For tests and checks. */
  get totalRounds(): number {
    return this.pouch.reduce((sum, rounds) => sum + rounds, this.loadedRounds);
  }

  /** True if the fullest spare has more rounds than the one in the gun, so a reload would help. */
  get canReload(): boolean {
    return this.fullestIndex() >= 0 && this.pouch[this.fullestIndex()] > this.loadedRounds;
  }

  /** Fires one round. Returns false if the gun is empty. */
  takeRound(): boolean {
    if (this.loadedRounds <= 0) return false;
    this.loadedRounds -= 1;
    return true;
  }

  /** Puts the gun's magazine back in the pouch as it is (unless empty) and loads the fullest spare. */
  reload(): boolean {
    if (!this.canReload) return false;
    const [fullest] = this.pouch.splice(this.fullestIndex(), 1);
    if (this.loadedRounds > 0) this.pouch.push(this.loadedRounds);
    this.loadedRounds = fullest;
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
