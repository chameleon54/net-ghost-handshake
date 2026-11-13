// Rifle (M4-A) tuning. All starting values, to be readjusted by feel. Units are in the names.
export const rifleConfigDefaults = {
  /** Rounds per minute while the trigger is held. Not in weapons.md; a starting value. */
  fireRateRpm: 700,
  /** Time from pressing R to the new magazine being in. */
  reloadTimeSec: 1.8,
  /** Extra time an empty reload takes: the rack that chambers a round. */
  emptyReloadRackSec: 0.4,
  /** How long checking the magazine takes (hold R). */
  checkMagazineSec: 1.0,
  /** Time after switching to the rifle before it can fire or reload (weapons.md). */
  drawTimeSec: 0.4,
  /** Rounds in a full magazine. Read once at start, so it is not on the tuning panel. */
  magazineRounds: 30,
  /** Magazines carried at the start, including the loaded one (the Squad Waves loadout). Read once at start. */
  startingMagazines: 4,
  /** Damage of a body hit. A headshot has no number: it always kills. Starting value, the same class as the enemy rifle (enemies.md). */
  bodyDamagePerHit: 15,
  /** Longest a bullet travels. Shared by every gun. */
  maxRangeM: 100,

  // Heat and jams (weapons.md): spraying heats the barrel, smoke from 50, jams from 60 and up.
  // One full magazine sprayed ends near 46 heat: no smoke and no jam. Two or three magazines in a row get it hot, and the jam risk then builds up shot by shot and only resets when a jam happens.
  heatPerShot: 1.5,
  heatCoolPerSec: 4, // slow: a barrel stays hot for a good while after spraying
  heatCoolDelaySec: 0.4,
  heatSmokeStart: 50,
  jamHeatStart: 60,
  jamRiskPerShotAtMaxHeat: 0.003,
  jamRiskMax: 0.3,
  jamChanceFlat: 0,
  jamFreeRounds: 5,
  jamFreeAfterClearSec: 10,
  jamClearTaps: 4,

  // Aiming down sights. About 1.4 degrees of scatter from the hip, about 0.1 when aimed.
  hipSpreadRad: 0.025,
  aimedSpreadRad: 0.002,
  aimTimeSec: 0.15,
  aimFovDeg: 55,
  aimMoveSpeedScale: 0.6,
  aimSensitivityScale: 0.7,

  // Recoil: the camera kicks up and a little sideways per shot, and settles back when the shooting stops.
  recoilPitchPerShotRad: 0.012,
  /** The most the view can be kicked up during a long spray. */
  recoilMaxPitchRad: 0.15,
  /** Each shot kicks sideways by a random amount up to this, left or right. */
  recoilYawPerShotRad: 0.004,
  recoilMaxYawRad: 0.04,
  /** After the last shot, the view stays kicked for this long before it settles. */
  recoilRecoveryDelaySec: 0.08,
  recoilRecoveryRadPerSec: 0.35,

  // Effects
  /** How fast the tracer streak flies. */
  tracerSpeedMps: 400,
  tracerLengthM: 5,
  /** Radius of a bullet mark on a wall. */
  markRadiusM: 0.04,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type RifleConfig = { -readonly [K in keyof typeof rifleConfigDefaults]: number };
export const rifleConfig: RifleConfig = { ...rifleConfigDefaults };
