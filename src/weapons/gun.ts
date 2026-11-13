import type { GunConfig } from '../config/gun';
import type { EventBus } from '../core/events';
import type { GunId, WeaponEvents } from './events';
import { Magazines } from './magazines';

export interface GunInput {
  triggerHeld: boolean;
  /** True once per click. A semi-automatic gun fires on this. */
  triggerPressed: boolean;
  /** True once per R press. */
  reloadPressed: boolean;
  /** False while sprinting, climbing, vaulting or drawing the gun. */
  canFire: boolean;
}

const secPerMinute = 60;

// A gun's rules: fire rate, empty click and reload. The rifle and the pistol are the same class with different
// numbers and fire mode. It only decides what happens and says so through events.
export class Gun {
  readonly magazines: Magazines;
  private cooldownSec = 0;
  private reloadLeftSec = 0;
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

  /** Switching away stops a reload; the magazine is untouched. */
  cancelReload(): void {
    this.reloadLeftSec = 0;
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

    if (input.reloadPressed && this.magazines.canReload) {
      this.reloadLeftSec = this.config.reloadTimeSec;
      this.events.emit('weapon:reload-started', undefined);
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
