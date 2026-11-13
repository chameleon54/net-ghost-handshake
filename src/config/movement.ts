import { healthConfig } from './health';

// Movement sounds (milestone 3.4): how far apart footsteps are, how loud each movement is, and what counts as a landing.
// Starting values, tuned in the dev panel. Units are in the names.
export const movementConfigDefaults = {
  /** Distance walked between footsteps (a step is heard each time). Longer strides at speed. */
  stepEveryWalkM: 1.7,
  stepEveryCrouchM: 1.2,
  stepEverySprintM: 2.2,
  /** Footstep loudness as a share of full: crouching is quieter, sprinting louder (gameplay.md). */
  stepVolumeWalk: 0.5,
  stepVolumeCrouch: 0.2,
  stepVolumeSprint: 1,
  /** The left and right foot are pitched this share apart, so steps do not sound identical. */
  footPitchShare: 0.03,
  slideVolume: 0.8,
  vaultVolume: 0.7,
  climbVolume: 0.7,
  /** Landing slower than this makes no sound (stepping off a very low edge). */
  landMinSpeedMps: 3.5,
  /** The quietest landing, as a share of full volume. */
  landSoftMinVolume: 0.35,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type MovementConfig = { -readonly [K in keyof typeof movementConfigDefaults]: number };
export const movementConfig: MovementConfig = { ...movementConfigDefaults };

/**
 * How hard a landing is, from 0 (just heard) to 1 (the hardest still counted as a safe landing). At or above the safe speed
 * of a fall (the speed from which it also hurts) it is 1, and the heavy sound is used.
 */
export function landingLoudness(speedMps: number): number {
  const range = Math.max(healthConfig.fallSafeSpeedMps - movementConfig.landMinSpeedMps, 1e-6);
  return Math.min(Math.max((speedMps - movementConfig.landMinSpeedMps) / range, 0), 1);
}
