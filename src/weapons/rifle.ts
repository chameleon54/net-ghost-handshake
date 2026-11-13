import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from './events';
import { Magazines } from './magazines';

export interface RifleInput {
  triggerHeld: boolean;
  /** True once per R press. */
  reloadPressed: boolean;
  /** False while sprinting, climbing or vaulting. */
  canFire: boolean;
}

const secPerMinute = 60;

// The M4-A's rules: fire rate, empty click and reload. It only decides what happens and says so through events.
export class Rifle {
  readonly magazines = new Magazines(rifleConfig.magazineRounds, rifleConfig.startingMagazines);
  private cooldownSec = 0;
  private reloadLeftSec = 0;
  private clickedThisPull = false;

  constructor(private readonly events: EventBus<WeaponEvents>) {}

  get reloading(): boolean {
    return this.reloadLeftSec > 0;
  }

  update(dtSec: number, input: RifleInput): void {
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

    if (input.reloadPressed && this.magazines.canReload) {
      this.reloadLeftSec = rifleConfig.reloadTimeSec;
      this.events.emit('weapon:reload-started', undefined);
      return;
    }

    if (!input.triggerHeld || !input.canFire || this.cooldownSec > 0) return;
    if (this.magazines.takeRound()) {
      this.cooldownSec += secPerMinute / rifleConfig.fireRateRpm;
      this.events.emit('weapon:fired', undefined);
    } else if (!this.clickedThisPull) {
      this.clickedThisPull = true; // once per pull, including a pull that ran dry mid-spray
      this.events.emit('weapon:empty-click', undefined);
    }
  }
}
