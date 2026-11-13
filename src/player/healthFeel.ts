import { healthFx } from '../config/healthFx';

// How health shows through the screen and the sound. No drawing or browser code, so tests can check it.

/** What the effects should be at a given health. Each is a target: the screen eases toward it. */
export interface HealthFeel {
  /** Red edge vignette strength, 0 to 1. */
  vignette: number;
  /** Share of the colour drained, 0 to 1. */
  drain: number;
  /** Heartbeats per minute, or 0 for none. */
  heartbeatPerMin: number;
  /** Heartbeat loudness, 0 to 1. */
  heartbeatVolume: number;
  /** Seconds between breaths, or 0 for no breathing. */
  breathEverySec: number;
  /** Breath loudness, 0 to 1. */
  breathVolume: number;
}

/** How far health has fallen from `from` toward `to`: 0 at or above `from`, 1 at or below `to`. */
function fallen(health: number, from: number, to: number): number {
  return Math.min(Math.max((from - health) / Math.max(from - to, 1e-6), 0), 1);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function healthFeel(health: number): HealthFeel {
  const c = healthFx;
  const feel: HealthFeel = { vignette: 0, drain: 0, heartbeatPerMin: 0, heartbeatVolume: 0, breathEverySec: 0, breathVolume: 0 };
  if (health <= c.vignetteStartHealth) feel.vignette = lerp(c.vignetteStartStrength, c.vignetteMaxStrength, fallen(health, c.vignetteStartHealth, c.vignetteFullHealth));
  feel.drain = c.drainMax * fallen(health, c.drainStartHealth, c.drainFullHealth);
  // Sound stops at 0: the dead make none. Both start strictly below their threshold, so a regenerated 50 is quiet.
  if (health > 0 && health < c.heartbeatBelowHealth) {
    const t = fallen(health, c.heartbeatBelowHealth, c.heartbeatFastHealth);
    feel.heartbeatPerMin = lerp(c.heartbeatSlowPerMin, c.heartbeatFastPerMin, t);
    feel.heartbeatVolume = c.heartbeatVolume * lerp(0.5, 1, t);
  }
  if (health > 0 && health < c.breathBelowHealth) {
    const t = fallen(health, c.breathBelowHealth, c.breathFastHealth);
    feel.breathEverySec = lerp(c.breathSlowEverySec, c.breathFastEverySec, t);
    feel.breathVolume = lerp(c.breathQuietVolume, c.breathLoudVolume, t);
  }
  return feel;
}

/**
 * The effects as they are right now: eased toward what health says, a flash that fades, a swell on each heartbeat, and
 * the moments a beat or a breath should sound. Once per game update; the screen and the sound both read it.
 */
export class HealthFeelState {
  vignette = 0;
  drain = 0;
  /** The red flash from being hit, 0 to `flashMax`. */
  flash = 0;
  /** The swell of the latest heartbeat, 1 at the beat falling to 0. */
  pulse = 0;
  /** True for the one update in which a heartbeat or a breath is due. */
  beatNow = false;
  breathNow = false;
  beatVolume = 0;
  breathVolume = 0;
  private beatTimerSec = 0;
  private breathTimerSec = 0;

  /** The player took `damage`: the screen flashes red. */
  hit(damage: number): void {
    this.flash = Math.min(this.flash + damage * healthFx.flashPerDamage, healthFx.flashMax);
  }

  /** Back to nothing (instant restart). */
  reset(): void {
    this.vignette = 0;
    this.drain = 0;
    this.flash = 0;
    this.pulse = 0;
    this.beatNow = false;
    this.breathNow = false;
    this.beatTimerSec = 0;
    this.breathTimerSec = 0;
  }

  update(dtSec: number, health: number): void {
    const target = healthFeel(health);
    const ease = 1 - Math.exp(-dtSec / Math.max(healthFx.easeSec, 0.01));
    this.vignette += (target.vignette - this.vignette) * ease;
    this.drain += (target.drain - this.drain) * ease;
    this.flash = Math.max(this.flash - (healthFx.flashMax / Math.max(healthFx.flashSec, 0.01)) * dtSec, 0);
    this.pulse = Math.max(this.pulse - dtSec / Math.max(healthFx.pulseSec, 0.01), 0);

    this.beatNow = false;
    if (target.heartbeatPerMin > 0) {
      this.beatTimerSec += dtSec;
      if (this.beatTimerSec >= 60 / target.heartbeatPerMin) {
        this.beatTimerSec = 0;
        this.beatNow = true;
        this.beatVolume = target.heartbeatVolume;
        this.pulse = 1;
      }
    } else {
      this.beatTimerSec = 0;
    }

    this.breathNow = false;
    if (target.breathEverySec > 0) {
      this.breathTimerSec += dtSec;
      if (this.breathTimerSec >= target.breathEverySec) {
        this.breathTimerSec = 0;
        this.breathNow = true;
        this.breathVolume = target.breathVolume;
      }
    } else {
      this.breathTimerSec = 0;
    }
  }
}
