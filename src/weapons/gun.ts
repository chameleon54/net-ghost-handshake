import type { GunConfig } from '../config/gun';
import type { EventBus } from '../core/events';
import type { GunId, WeaponEvents } from './events';
import { addJamRisk, heatMax, jamChance } from './jam';
import { checkMagazines } from './magazineFeel';
import { Magazines } from './magazines';

export interface GunInput {
  triggerHeld: boolean;
  /** True once per click. A semi-automatic gun fires on this. */
  triggerPressed: boolean;
  /** True once per reload tap (R let go quickly). While jammed, each one is a tap to clear the jam. */
  reloadPressed: boolean;
  /** True once when R has been held long enough to check the magazine. */
  checkRequested: boolean;
  /** False while sprinting, climbing, vaulting or drawing the gun. */
  canFire: boolean;
}

const secPerMinute = 60;
/** The player has looked at the magazine this far into the check: that is when the rough words are known. */
const checkLooksAtProgress = 0.35;

// A gun's rules: fire rate, heat and jams, empty click, reload and checking the magazine. The rifle and the pistol are
// the same class with different numbers and fire mode. It only decides what happens and says so through events.
export class Gun {
  readonly magazines: Magazines;
  /** 0 to 100. Each shot adds to it; it cools after a short wait. */
  heat = 0;
  /** Testing aid, set only by the dev panel: shots and thrown-out rounds use no ammo. Off in the real game. */
  infiniteAmmo = false;
  /** Built-up chance of a jam from running hot. It does not fall when the barrel cools: only a jam resets it to 0 (heat too, when the jam is cleared). */
  jamRisk = 0;
  private cooldownSec = 0;
  private sinceShotSec = Infinity;
  private reloadLeftSec = 0;
  private reloadTotalSec = 1;
  private reloadRackSec = 0;
  private checkLeftSec = 0;
  private checkTotalSec = 1;
  private checkReported = false;
  private clickedThisPull = false;
  private roundsFiredFromMagazine = 0;
  private sinceClearSec = Infinity;
  private isJammed = false;
  private clearTapsDone = 0;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    readonly id: GunId,
    private readonly config: GunConfig,
    /** Automatic guns fire while the trigger is held; semi-automatic ones once per click. */
    private readonly automatic: boolean,
    /** Gives a number from 0 to 1. Tests replace it to force or forbid a jam. */
    private readonly random: () => number = Math.random,
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

  /** True while the chambered round is stuck: the trigger only clicks, and R taps clear it. */
  get jammed(): boolean {
    return this.isJammed;
  }

  /** The chance that the next shot would jam right now, 0 to 1. For the dev readout. */
  get jamChanceNow(): number {
    return jamChance(this.config, this.jamRisk, this.roundsFiredFromMagazine, this.sinceClearSec);
  }

  /** Switching away (or any other interruption) stops a reload or a check, and forgets taps already made on a jam. */
  interrupt(): void {
    this.reloadLeftSec = 0;
    this.checkLeftSec = 0;
    this.clearTapsDone = 0; // the jam itself stays: it must be cleared, from the first tap again
  }

  /** Time passing for a gun that is not in hand: it keeps cooling. */
  tickHeat(dtSec: number): void {
    this.sinceShotSec += dtSec;
    this.sinceClearSec += dtSec;
    // A jammed barrel stays as hot as it was (and keeps smoking) until the jam is cleared.
    if (!this.isJammed && this.sinceShotSec >= this.config.heatCoolDelaySec) {
      this.heat = Math.max(this.heat - this.config.heatCoolPerSec * dtSec, 0);
    }
  }

  update(dtSec: number, input: GunInput): void {
    this.tickHeat(dtSec);
    // Cooldown may go a little negative so the average rate is right, but never far: no burst after idling.
    this.cooldownSec = Math.max(this.cooldownSec - dtSec, -dtSec);
    if (!input.triggerHeld) this.clickedThisPull = false;

    if (this.isJammed) {
      this.updateJammed(input);
      return;
    }

    if (this.reloading) {
      this.reloadLeftSec -= dtSec;
      if (this.reloadLeftSec <= 0) {
        this.reloadLeftSec = 0;
        this.magazines.reload();
        this.roundsFiredFromMagazine = 0; // a new magazine: the first rounds are safe from jams again
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
    if (!this.magazines.chambered) {
      if (!this.clickedThisPull) {
        this.clickedThisPull = true; // once per pull, including a pull that ran dry mid-spray
        this.events.emit('weapon:empty-click', undefined);
      }
      return;
    }

    // A round is ready. It may jam instead of firing: then nothing is fired and no round is used yet.
    const chance = jamChance(this.config, this.jamRisk, this.roundsFiredFromMagazine, this.sinceClearSec);
    if (chance > 0 && this.random() < chance) {
      this.isJammed = true;
      this.jamRisk = 0; // the built-up risk is spent
      this.clearTapsDone = 0;
      this.clickedThisPull = true; // this pull's dead click is the jam itself
      this.events.emit('weapon:jammed', { weapon: this.id });
      return;
    }
    if (!this.infiniteAmmo) this.magazines.takeRound();
    this.roundsFiredFromMagazine += 1;
    this.heat = Math.min(this.heat + this.config.heatPerShot, heatMax);
    this.jamRisk = addJamRisk(this.config, this.jamRisk, this.heat);
    this.sinceShotSec = 0;
    this.cooldownSec += secPerMinute / this.config.fireRateRpm;
    this.events.emit('weapon:fired', { weapon: this.id });
  }

  /** While jammed: the trigger only clicks; each separate tap of R is one rack, and the last one clears the jam. */
  private updateJammed(input: GunInput): void {
    const wantsShot = this.automatic ? input.triggerHeld : input.triggerPressed;
    if (wantsShot && input.canFire && !this.clickedThisPull) {
      this.clickedThisPull = true;
      this.events.emit('weapon:jam-click', { weapon: this.id });
    }
    if (!input.reloadPressed || !input.canFire) return; // a hold (the magazine check) does nothing while jammed
    this.clearTapsDone += 1;
    this.events.emit('weapon:rack', { weapon: this.id, tap: this.clearTapsDone, taps: this.config.jamClearTaps });
    if (this.clearTapsDone >= this.config.jamClearTaps) {
      if (!this.infiniteAmmo) this.magazines.takeRound(); // the stuck round is thrown out: it is lost
      this.isJammed = false;
      this.heat = 0; // the last tap lets the barrel go cold: the smoke stops
      this.clearTapsDone = 0;
      this.sinceClearSec = 0;
      this.events.emit('weapon:jam-cleared', { weapon: this.id });
    }
  }
}
