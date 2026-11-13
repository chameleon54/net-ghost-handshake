import { healthConfig } from '../config/health';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import type { PlayerHealth } from './playerHealth';

export interface HealInput {
  /** True once per press of H. */
  pressed: boolean;
  /** False while climbing, vaulting, throwing, drawing, reloading or checking the magazine. */
  canUse: boolean;
}

// Rook's heal items: how many he carries, and the use: it takes `healUseSec`, and the health lands at the end. While it
// lasts the hands are busy (the game checks `busy`): no firing, reloading, throwing or switching, and no sprinting or
// climbing. Walking is allowed, and damage does not cancel it. No drawing code here.
export class HealItems {
  private carried: number;
  /** Seconds since the use began, or null when not using one. */
  private sinceStartSec: number | null = null;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly health: PlayerHealth,
  ) {
    this.carried = Math.min(healthConfig.startingHeals, healthConfig.healCarryLimit);
  }

  get count(): number {
    return this.carried;
  }

  get busy(): boolean {
    return this.sinceStartSec !== null;
  }

  /** Picks up heals (from a drop, later), up to the carry limit. Returns how many were taken. */
  give(count: number): number {
    const taken = Math.max(Math.min(count, healthConfig.healCarryLimit - this.carried), 0);
    this.carried += taken;
    return taken;
  }

  /** Back to the starting heals, hands free (instant restart). */
  reset(): void {
    this.carried = Math.min(healthConfig.startingHeals, healthConfig.healCarryLimit);
    this.sinceStartSec = null;
  }

  update(dtSec: number, input: HealInput): void {
    if (this.health.dead) this.sinceStartSec = null; // death cancels it
    if (this.sinceStartSec === null) {
      // Nothing is used at full health, so none is wasted.
      if (!input.pressed || !input.canUse || this.carried <= 0 || this.health.dead || this.health.full) return;
      this.carried -= 1; // spent as soon as it is opened, whatever happens next
      this.sinceStartSec = 0;
      this.events.emit('heal:started', undefined);
      return;
    }
    this.sinceStartSec += dtSec;
    if (this.sinceStartSec >= healthConfig.healUseSec) {
      this.sinceStartSec = null;
      this.health.heal(healthConfig.healAmount);
    }
  }
}
