import type { GunConfig } from '../config/gun';
import type { EventBus } from '../core/events';
import type { GunId, WeaponEvents } from './events';
import { checkMagazines } from './magazineFeel';
import { Magazines } from './magazines';

export interface GunInput {
  triggerHeld: boolean;
  /** True once per click. A semi-automatic gun fires on this. */
  triggerPressed: boolean;
  /** True once per reload tap (R let go quickly). */
  reloadPressed: boolean;
  /** True once when R has been held long enough to check the magazine. */
  checkRequested: boolean;
  /** False while sprinting, climbing, vaulting or drawing the gun. */
  canFire: boolean;
}

const secPerMinute = 60;
/** The player has looked at the magazine this far into the check: that is when the rough word is known. */
const checkLooksAtProgress = 0.35;

// A gun's rules: fire rate, empty click, reload and checking the magazine. The rifle and the pistol are the same class
// with different numbers and fire mode. It only decides what happens and says so through events.
export class Gun {
  readonly magazines: Magazines;
  private cooldownSec = 0;
  private reloadLeftSec = 0;
  private reloadTotalSec = 1;
  private reloadRackSec = 0;
  private checkLeftSec = 0;
  private checkTotalSec = 1;
  private checkReported = false;
  private clickedThisPull = false;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    readonly id: GunId,
    private readonly config: GunConfig,
    /** Automatic guns fire while the trigger is held; semi-automatic ones once per click. */
    private readonly automatic: boolean,
  ) {
    this.magazines = new Magazines(config.magazineRounds, config.startingMagazines);
  }

  get reloading(): boolean {
    return this.reloadLeftSec > 0;
  }

  /** How far through the reload we are, 0 to 1 (0 when not reloading). The reload animation follows this. */
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadLeftSec / this.reloadTotalSec : 0;
  }

  /** The share of the current reload that is the rack of an empty gun, 0 to 1 (0 for a reload with rounds left). */
  get reloadRackShare(): number {
    return this.reloading ? this.reloadRackSec / this.reloadTotalSec : 0;
  }

  get checking(): boolean {
    return this.checkLeftSec > 0;
  }

  /** How far through checking the magazine we are, 0 to 1 (0 when not checking). */
  get checkProgress(): number {
    return this.checking ? 1 - this.checkLeftSec / this.checkTotalSec : 0;
  }

  /** True when there is nothing left to fire: the slide or bolt stays locked back. */
  get empty(): boolean {
    return this.magazines.loadedRounds === 0;
  }

  /** Switching away (or any other interruption) stops a reload or a check. The magazines are untouched. */
  interrupt(): void {
    this.reloadLeftSec = 0;
    this.checkLeftSec = 0;
  }

  update(dtSec: number, input: GunInput): void {
    // Cooldown may go a little negative so the average rate is right, but never far: no burst after idling.
    this.cooldownSec = Math.max(this.cooldownSec - dtSec, -dtSec);
    if (!input.triggerHeld) this.clickedThisPull = false;

    if (this.reloading) {
      this.reloadLeftSec -= dtSec;
      if (this.reloadLeftSec <= 0) {
        this.reloadLeftSec = 0;
        this.magazines.reload();
        this.events.emit('weapon:reloaded', undefined);
      }
      return; // no firing while reloading
    }

    if (this.checking) {
      this.checkLeftSec -= dtSec;
      if (!this.checkReported && this.checkProgress >= checkLooksAtProgress) {
        this.checkReported = true;
        this.events.emit('weapon:magazine-checked', { check: checkMagazines(this.magazines) });
      }
      // Sprinting, climbing or vaulting puts the magazine away.
      if (!input.canFire) this.interrupt();
      else if (this.checkLeftSec <= 0) this.checkLeftSec = 0;
      return; // no firing or reloading while looking at the magazine
    }

    if (input.reloadPressed && this.magazines.canReload) {
      // An empty gun has no round in the chamber: the reload ends with a rack, which takes extra time.
      this.reloadRackSec = this.magazines.chambered ? 0 : this.config.emptyReloadRackSec;
      this.reloadTotalSec = this.config.reloadTimeSec + this.reloadRackSec;
      this.reloadLeftSec = this.reloadTotalSec;
      this.events.emit('weapon:reload-started', undefined);
      return;
    }

    if (input.checkRequested && input.canFire) {
      this.checkTotalSec = this.config.checkMagazineSec;
      this.checkLeftSec = this.checkTotalSec;
      this.checkReported = false;
      return;
    }

    const wantsShot = this.automatic ? input.triggerHeld : input.triggerPressed;
    if (!wantsShot || !input.canFire || this.cooldownSec > 0) return;
    if (this.magazines.takeRound()) {
      this.cooldownSec += secPerMinute / this.config.fireRateRpm;
      this.events.emit('weapon:fired', { weapon: this.id });
    } else if (!this.clickedThisPull) {
      this.clickedThisPull = true; // once per pull, including a pull that ran dry mid-spray
      this.events.emit('weapon:empty-click', undefined);
    }
  }
}
