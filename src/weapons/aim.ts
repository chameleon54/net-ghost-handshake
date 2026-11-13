import type { GunConfig } from '../config/gun';
import { rifleConfig } from '../config/rifle';

const minAimTimeSec = 0.01; // stops a divide by zero if the panel is set to 0

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

// How far the player is into aiming down sights. No drawing code here.
// `blend` moves from 0 (hip) to 1 (fully aimed) over the gun's aim time; `eased` is the same, smoothed at both ends.
export class Aim {
  blend = 0;
  /** The gun that decides the zoom, speed and turn scales: the one in hand, or the last one if the knife is out. */
  private config: GunConfig = rifleConfig;

  get eased(): number {
    return this.blend * this.blend * (3 - 2 * this.blend);
  }

  /** `wantsAim`: the button is held and aiming is allowed right now. `config` is the gun in hand, or null for the knife. */
  update(dtSec: number, wantsAim: boolean, config: GunConfig | null): void {
    if (config) this.config = config;
    const stepPerSec = 1 / Math.max(this.config.aimTimeSec, minAimTimeSec);
    this.blend = wantsAim ? Math.min(this.blend + stepPerSec * dtSec, 1) : Math.max(this.blend - stepPerSec * dtSec, 0);
  }

  fovDeg(baseFovDeg: number): number {
    return lerp(baseFovDeg, this.config.aimFovDeg, this.eased);
  }

  get moveSpeedScale(): number {
    return lerp(1, this.config.aimMoveSpeedScale, this.eased);
  }

  get sensitivityScale(): number {
    return lerp(1, this.config.aimSensitivityScale, this.eased);
  }
}
