// Player health and what hurts it (milestone 3.1). All starting values. Units are in the names.
export const healthConfigDefaults = {
  maxHealth: 100,
  /** Regeneration starts this long after the last damage... */
  regenDelaySec: 4,
  /** ...and stops here: it never lifts health above this (only a heal does). */
  regenCeiling: 50,
  /** Regeneration speed by difficulty (owner's choice: fast on Easy, slower on Normal and Hard). */
  regenPerSecEasy: 10,
  regenPerSecNormal: 5,
  regenPerSecHard: 5,
  /** A heal item restores this much, over its use time. */
  healAmount: 50,
  healUseSec: 1,
  /** Read when the game starts or restarts: not on the panel. */
  healCarryLimit: 3,
  startingHeals: 3,
  /** The test hazard pad in the grey-box room. */
  hazardDamagePerSec: 20,
  /** Landing at or below this speed hurts nothing (about a 2.5 m drop). */
  fallSafeSpeedMps: 10,
  /** Damage for each m/s of landing speed above the safe speed (decision 115). */
  fallDamagePerMps: 12,
  /** After a hard landing walking is slowed for this long... */
  fallSlowBaseSec: 1.0,
  /** ...plus this for each m/s above the safe speed... */
  fallSlowPerMpsSec: 0.3,
  /** ...but never longer than this. */
  fallSlowMaxSec: 4,
  /** While slowed, walking speed is this share of normal, and sprinting is not allowed. */
  fallSlowSpeedShare: 0.5,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type HealthConfig = { -readonly [K in keyof typeof healthConfigDefaults]: number };
export const healthConfig: HealthConfig = { ...healthConfigDefaults };
