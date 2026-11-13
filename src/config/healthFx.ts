// How health shows through the screen and sound (milestone 3.3), and how long HUD pop-ups stay. All starting values.
// Health is on a 0 to 100 scale. Units are in the names.
export const healthFxDefaults = {
  // The red edge vignette. Nothing above `vignetteStartHealth`; a faint one at it, growing to the strongest at `vignetteFullHealth`.
  vignetteStartHealth: 50,
  vignetteFullHealth: 10,
  vignetteStartStrength: 0.25,
  vignetteMaxStrength: 0.85,
  // Colour drain: starts at `drainStartHealth`, strongest at `drainFullHealth`; never takes more than `drainMax` of the colour.
  drainStartHealth: 35,
  drainFullHealth: 5,
  drainMax: 0.7,
  /** The effects ease toward where health says they should be, with this time constant. */
  easeSec: 0.4,
  // Heartbeat: below `heartbeatBelowHealth`, slow at first and faster as health falls to `heartbeatFastHealth`.
  heartbeatBelowHealth: 30,
  heartbeatFastHealth: 5,
  heartbeatSlowPerMin: 70,
  heartbeatFastPerMin: 140,
  heartbeatVolume: 0.8,
  /** How much the vignette swells on each beat (a share of its strength), and how fast the swell dies away. */
  pulseDepth: 0.3,
  pulseSec: 0.35,
  // Heavy breathing: below `breathBelowHealth`, faint and slow at first, louder and quicker as health falls to `breathFastHealth`.
  breathBelowHealth: 50,
  breathFastHealth: 5,
  breathSlowEverySec: 4,
  breathFastEverySec: 1.4,
  breathQuietVolume: 0.2,
  breathLoudVolume: 0.8,
  // The red flash when hit: each point of damage adds `flashPerDamage` (up to `flashMax`), and it fades over `flashSec`.
  flashPerDamage: 0.012,
  flashMax: 0.5,
  flashSec: 0.4,
  // HUD pop-ups.
  /** A pop-up (weapon name, grenades, heals) stays this long, then fades over `hudFadeSec`. */
  hudShowSec: 2.5,
  hudFadeSec: 0.5,
  /** The magazine pictures stay this long after a check or a reload. */
  magazinePictureShowSec: 3,
  /** The floating picture of the gun's magazine sits this far left of the magazine on screen. */
  gunMagazineOffsetPx: -64,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type HealthFxConfig = { -readonly [K in keyof typeof healthFxDefaults]: number };
export const healthFx: HealthFxConfig = { ...healthFxDefaults };
