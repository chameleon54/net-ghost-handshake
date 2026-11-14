// Sound tuning (milestone 2.7). Starting values. Volumes are shares of full volume (1 is as made).
export const audioConfigDefaults = {
  /** Overall volume. */
  masterVolume: 0.8,
  /** Gunshots, the rattle of a hot barrel and a knife stab. */
  weaponVolume: 1,
  /** Handling: clicks, racks, magazines, draws, swings, inspects. */
  handlingVolume: 0.8,
  /** Movement: footsteps, the slide, vaults, climbs and landings. */
  movementVolume: 0.8,
  /** Bullet impacts, hit ticks and bouncing casings. */
  impactVolume: 0.6,
  /** How loud the suppressed P9 is next to the rifle: quieter, never silent. */
  pistolLoudness: 0.5,
  /** Heat at which a gunshot starts to gain a rattle; it gets louder up to 100. */
  rattleStartHeat: 70,
  /** Each sound is played a little higher or lower, up to this share, so a spray does not repeat one sample. */
  pitchVariation: 0.04,
  /** Ears ringing after a close blast. Volume 0 means no ringing sound yet: drop `sfx-ear-ringing.ogg` into src/assets/audio/ and raise it. */
  earRingingVolume: 0,
  /** How much everything else is lowered while the ears ring (0 none, 1 silent). Off until the sound exists. */
  earRingingDuckShare: 0,
  /** A blast closer than this rings the ears (more the closer it is), and the ringing lasts up to this long. */
  earRingingRadiusM: 6,
  earRingingMaxSec: 4,
  /** Casing clinks come no more often than once per this gap, so a spray is not a wall of clinks. */
  casingClinkMinGapSec: 0.05,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type AudioConfig = { -readonly [K in keyof typeof audioConfigDefaults]: number };
export const audioConfig: AudioConfig = { ...audioConfigDefaults };
