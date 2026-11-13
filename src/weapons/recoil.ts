import type { GunConfig } from '../config/gun';
import { rifleConfig } from '../config/rifle';

// How far the view is kicked by firing. It is an offset on top of where the mouse points, so the view
// returns to where it was before the spray. No drawing code here.
export class Recoil {
  /** Positive is up. */
  pitchRad = 0;
  /** Positive is left. */
  yawRad = 0;
  private sinceShotSec = Infinity;

  /** The gun that fired last decides how the view settles, even after switching weapon. */
  constructor(private config: GunConfig = rifleConfig) {}

  /** One shot. `random` is a number from -1 to 1 that picks the sideways kick (Math.random() * 2 - 1). */
  kick(random: number, config: GunConfig = this.config): void {
    this.config = config;
    this.pitchRad = Math.min(this.pitchRad + config.recoilPitchPerShotRad, config.recoilMaxPitchRad);
    const yaw = this.yawRad + random * config.recoilYawPerShotRad;
    this.yawRad = Math.max(-config.recoilMaxYawRad, Math.min(config.recoilMaxYawRad, yaw));
    this.sinceShotSec = 0;
  }

  reset(): void {
    this.pitchRad = 0;
    this.yawRad = 0;
    this.sinceShotSec = Infinity;
  }

  update(dtSec: number): void {
    this.sinceShotSec += dtSec;
    if (this.sinceShotSec < this.config.recoilRecoveryDelaySec) return;
    const stepRad = this.config.recoilRecoveryRadPerSec * dtSec;
    this.pitchRad = Math.max(this.pitchRad - stepRad, 0);
    this.yawRad = this.yawRad > 0 ? Math.max(this.yawRad - stepRad, 0) : Math.min(this.yawRad + stepRad, 0);
  }
}
