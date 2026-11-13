// Pistol (P9) tuning. All starting values, to be readjusted by feel. Units are in the names.
// The P9 is always suppressed (weapons.md); who hears it is the noise system's job, later.
export const pistolConfigDefaults = {
  /** Semi-automatic: one shot per click. This caps how fast clicking can fire. */
  fireRateRpm: 600,
  reloadTimeSec: 1.2,
  emptyReloadRackSec: 0.3,
  checkMagazineSec: 0.9,
  drawTimeSec: 0.25,
  /** Read once at start, so it is not on the tuning panel. */
  magazineRounds: 17,
  /** The Squad Waves loadout, including the loaded one. Read once at start. */
  startingMagazines: 3,
  /** The least lethal gun in the game, the same class as the enemy pistol (enemies.md). A headshot always kills. */
  bodyDamagePerHit: 8,

  // Heat and jams: the P9 does not heat, but has a very rare flat chance (about 1 in 400 shots) to jam.
  heatPerShot: 0,
  heatCoolPerSec: 15,
  heatCoolDelaySec: 0.4,
  heatSmokeStart: 50,
  jamHeatStart: 60,
  jamRiskPerShotAtMaxHeat: 0,
  jamRiskMax: 0.3,
  jamChanceFlat: 0.0025,
  jamFreeRounds: 5,
  jamFreeAfterClearSec: 10,
  jamClearTaps: 2,

  // Aiming down sights. About 1.1 degrees of scatter from the hip, about 0.1 when aimed.
  hipSpreadRad: 0.019,
  aimedSpreadRad: 0.002,
  aimTimeSec: 0.1,
  aimFovDeg: 62,
  aimMoveSpeedScale: 0.75,
  aimSensitivityScale: 0.8,

  // Recoil: a sharp kick that settles within about 0.1 s.
  recoilPitchPerShotRad: 0.03,
  recoilMaxPitchRad: 0.06,
  recoilYawPerShotRad: 0.006,
  recoilMaxYawRad: 0.02,
  recoilRecoveryDelaySec: 0.03,
  recoilRecoveryRadPerSec: 0.4,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type PistolConfig = { -readonly [K in keyof typeof pistolConfigDefaults]: number };
export const pistolConfig: PistolConfig = { ...pistolConfigDefaults };
