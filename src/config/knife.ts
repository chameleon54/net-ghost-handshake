// Knife tuning. All starting values, to be readjusted by feel. Units are in the names.
export const knifeConfigDefaults = {
  /** How far in front of the eyes a swing can hit. */
  reachM: 1.5,
  /** Time between swings. */
  swingCooldownSec: 0.5,
  drawTimeSec: 0.2,
  /** Damage from the front. From behind the knife kills at once. */
  frontDamagePerHit: 50,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type KnifeConfig = { -readonly [K in keyof typeof knifeConfigDefaults]: number };
export const knifeConfig: KnifeConfig = { ...knifeConfigDefaults };
