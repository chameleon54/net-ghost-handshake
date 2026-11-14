import { knifeConfig } from '../config/knife';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from './events';

export interface KnifeInput {
  /** True once per click. */
  triggerPressed: boolean;
  /** False while sprinting, climbing, vaulting or drawing the knife. */
  canFire: boolean;
}

// The knife's rules: a swing, then a wait. What the swing hits is worked out by KnifeStrike. It never jams and is silent.
export class Knife {
  private cooldownSec = 0;

  constructor(private readonly events: EventBus<WeaponEvents>) {}

  reset(): void {
    this.cooldownSec = 0;
  }

  update(dtSec: number, input: KnifeInput): void {
    this.cooldownSec = Math.max(this.cooldownSec - dtSec, 0);
    if (!input.triggerPressed || !input.canFire || this.cooldownSec > 0) return;
    this.cooldownSec = knifeConfig.swingCooldownSec;
    this.events.emit('weapon:swing', undefined);
  }
}
