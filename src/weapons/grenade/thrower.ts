import { grenadeConfig } from '../../config/grenade';
import type { EventBus } from '../../core/events';
import type { WeaponEvents } from '../events';

export interface ThrowerInput {
  /** True once per press of G. */
  pressed: boolean;
  /** False while sprinting, climbing, vaulting, drawing, reloading or checking the magazine. */
  canThrow: boolean;
}

// Rook's grenades: how many he carries, and the throw: pull the pin, wind up, let go, follow through. It only decides
// what happens and says so through events; the grenade itself is flown by GrenadeSystem. While the throw lasts the hands
// are busy: no firing, reloading, aiming or switching (the game checks `busy`). No drawing code here.
export class GrenadeThrower {
  private carried: number;
  /** Seconds since the pin was pulled, or null when not throwing. */
  private sinceStartSec: number | null = null;
  private released = false;
  /** True for the one update in which the throw ended and the hands are free again. */
  justFinished = false;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    startingGrenades: number = grenadeConfig.startingGrenades,
  ) {
    this.carried = Math.min(startingGrenades, grenadeConfig.carryLimit);
  }

  get count(): number {
    return this.carried;
  }

  /** True from the pin to the end of the follow-through. */
  get busy(): boolean {
    return this.sinceStartSec !== null;
  }

  /** How far through the whole throw we are, 0 to 1 (0 when not throwing). The throw animation follows this. */
  get progress(): number {
    return this.sinceStartSec === null ? 0 : Math.min(this.sinceStartSec / this.totalSec, 1);
  }

  /** The share of the throw at which the grenade leaves the hand. */
  get releaseShare(): number {
    return grenadeConfig.windupSec / this.totalSec;
  }

  /** Picks up grenades (from a body, later), up to the carry limit. Returns how many were taken. */
  give(count: number): number {
    const taken = Math.max(Math.min(count, grenadeConfig.carryLimit - this.carried), 0);
    this.carried += taken;
    return taken;
  }

  update(dtSec: number, input: ThrowerInput): void {
    this.justFinished = false;
    if (this.sinceStartSec === null) {
      if (!input.pressed || !input.canThrow || this.carried <= 0) return;
      this.carried -= 1; // the pin is out: this grenade is spent whatever happens next
      this.sinceStartSec = 0;
      this.released = false;
      this.events.emit('grenade:pin', undefined);
      return;
    }
    this.sinceStartSec += dtSec;
    if (!this.released && this.sinceStartSec >= grenadeConfig.windupSec) {
      this.released = true;
      this.events.emit('grenade:release', undefined);
    }
    if (this.sinceStartSec >= this.totalSec) {
      this.sinceStartSec = null;
      this.justFinished = true;
    }
  }

  private get totalSec(): number {
    return Math.max(grenadeConfig.windupSec + grenadeConfig.followThroughSec, 0.01);
  }
}
