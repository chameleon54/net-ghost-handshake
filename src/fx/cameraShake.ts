import type { Vector3 } from 'three';
import { grenadeConfig } from '../config/grenade';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import { Spring } from '../weapons/viewmodel/spring';

const shakeFrequencyHz = 11;
const shakeDamping = 0.25; // low: it rings a few times before it settles
const maxKickRad = 0.2; // never more than this, however close

// A shake of the view when a grenade goes off: a push on the view angles that rings and settles, harder the closer the
// blast. It is an offset on top of where the player looks, like the recoil. No drawing code here.
export class CameraShake {
  private readonly pitch = new Spring(shakeFrequencyHz, shakeDamping);
  private readonly yaw = new Spring(shakeFrequencyHz, shakeDamping);

  constructor(
    events: EventBus<WeaponEvents>,
    /** Where the player's head is. */
    private readonly headPosition: () => Vector3,
    private readonly random: () => number = Math.random,
  ) {
    events.on('grenade:exploded', ({ position }) => this.shake(position.distanceTo(this.headPosition())));
  }

  get pitchRad(): number {
    return this.pitch.value;
  }

  get yawRad(): number {
    return this.yaw.value;
  }

  /** Shakes the view for a blast `distanceM` away: nothing beyond the shake radius. */
  shake(distanceM: number): void {
    const closeness = 1 - distanceM / Math.max(grenadeConfig.shakeRadiusM, 0.1);
    if (closeness <= 0) return;
    const rad = Math.min(grenadeConfig.shakeMaxRad * closeness, maxKickRad);
    this.pitch.impulse(rad * (this.random() < 0.5 ? -1 : 1));
    this.yaw.impulse(rad * (this.random() * 2 - 1));
  }

  update(dtSec: number): void {
    this.pitch.update(dtSec);
    this.yaw.update(dtSec);
  }
}
