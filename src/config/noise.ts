// How far each sound the player makes can be heard by enemies (milestone 2.10). Starting values, to be readjusted by feel.
// Distances in metres. Walls do not muffle them yet: hearing is by distance only (decision 2.10, upgraded in 4.10).
export const noiseConfigDefaults = {
  /** An M4-A shot: loud, heard across a good part of the lab. */
  rifleShotM: 40,
  /** A P9 shot: suppressed, heard only close by (weapons.md: about 5 m). */
  pistolShotM: 5,
  /** A bullet hitting a wall or the floor. Loud even from the P9: bullets hitting metal are not suppressed. */
  impactM: 15,
  /** Pulling the trigger on an empty gun. Enemies hear it and may push (enemies.md). */
  emptyClickM: 12,
  /** Starting a reload. */
  reloadM: 10,
  /** A jam, a dead click on a jammed gun, and each rack while clearing one. */
  jamM: 12,
  jamClickM: 8,
  rackM: 6,
  /** The knife is quiet. */
  knifeSwingM: 2,
  knifeStabM: 4,
  /** A grenade bouncing, and its blast. */
  grenadeBounceM: 8,
  grenadeBlastM: 80,
  /** Footsteps (milestone 3.4): crouching is close to silent, sprinting is loud (gameplay.md). */
  walkStepM: 6,
  crouchStepM: 2,
  sprintStepM: 15,
  slideM: 10,
  vaultM: 6,
  climbM: 5,
  /** A landing: this far for a light one, this far for a hard fall. */
  landingSoftM: 6,
  landingHardM: 15,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type NoiseConfig = { -readonly [K in keyof typeof noiseConfigDefaults]: number };
export const noiseConfig: NoiseConfig = { ...noiseConfigDefaults };
