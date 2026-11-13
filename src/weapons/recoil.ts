import { rifleConfig } from '../config/rifle';

// How far the view is kicked by firing. It is an offset on top of where the mouse points, so the view
// returns to where it was before the spray. No drawing code here.
export class Recoil {
  /** Positive is up. */
  pitchRad = 0;
  /** Positive is left. */
  yawRad = 0;
  private sinceShotSec = Infinity;

  /** One shot. `random` is a number from -1 to 1 that picks the sideways kick (Math.random() * 2 - 1). */
  kick(random: number): void {
    this.pitchRad = Math.min(this.pitchRad + rifleConfig.recoilPitchPerShotRad, rifleConfig.recoilMaxPitchRad);
    const yaw = this.yawRad + random * rifleConfig.recoilYawPerShotRad;
    this.yawRad = Math.max(-rifleConfig.recoilMaxYawRad, Math.min(rifleConfig.recoilMaxYawRad, yaw));
    this.sinceShotSec = 0;
  }

  update(dtSec: number): void {
    this.sinceShotSec += dtSec;
    if (this.sinceShotSec < rifleConfig.recoilRecoveryDelaySec) return;
    const stepRad = rifleConfig.recoilRecoveryRadPerSec * dtSec;
    this.pitchRad = Math.max(this.pitchRad - stepRad, 0);
    this.yawRad = this.yawRad > 0 ? Math.max(this.yawRad - stepRad, 0) : Math.min(this.yawRad + stepRad, 0);
  }
}
