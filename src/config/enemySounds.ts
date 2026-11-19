// Enemy sounds (milestone 4.14, decision 264; audio.md "Sound effects"): footsteps you can place by ear, and a shot per gun.
// Steps are timed by distance moved until enemy animation (7b) gives a walk cycle; sound design (7d) refines them.
// Starting values. Units are in the names; volumes are shares of the sound as made.
export const enemySoundConfigDefaults = {
  /** A step each time an enemy has moved this far on the ground, walking. */
  strideWalkM: 0.75,
  /** ...running (moving at least `runFromSpeedMps`): longer strides. */
  strideRunM: 1.3,
  /** ...moving crouched (behind low cover, the side step of a crouched peek). */
  strideCrouchM: 0.6,
  /** Moving at least this fast counts as running. Troopers run at 4 m/s and walk at 2.5 (roles.ts). */
  runFromSpeedMps: 3.2,
  /** How loud a step is, walking. */
  stepVolumeWalk: 0.6,
  /** ...running. */
  stepVolumeRun: 0.9,
  /** ...moving crouched. */
  stepVolumeCrouch: 0.3,
  /** The heavy is heavier: its steps this many times louder... */
  heavyStepLoudness: 1.3,
  /** ...and at this pitch (below 1 is deeper). */
  heavyStepPitch: 0.85,
  /** The left and right foot pitched apart by this share, as Rook's are. */
  footPitchShare: 0.03,
  /** How loud each enemy gun's shot is. The pistol is the flankers', the rifle the troopers' and leader's, the machine gun the heavy's. */
  pistolVolume: 0.75,
  rifleVolume: 1,
  lmgVolume: 1,
  /** An enemy's reload (4.16): Rook's magazine sounds from where it is, at this volume. */
  reloadVolume: 0.6,
};

export type EnemySoundConfig = { -readonly [K in keyof typeof enemySoundConfigDefaults]: number };

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export const enemySoundConfig: EnemySoundConfig = { ...enemySoundConfigDefaults };
