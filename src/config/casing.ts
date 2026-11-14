// Ejected casings (milestone 2.5). Cosmetic only. Units are in the names.
export const casingConfigDefaults = {
  /** Speed out of the gun, to the right of the view. */
  ejectSpeedMps: 2.5,
  /** Speed upward as it leaves. */
  ejectUpMps: 1.6,
  /** Random extra speed in every direction, so they do not all fly the same way. */
  ejectSpreadMps: 0.6,
  gravityMps2: 9.8,
  /** Share of speed kept after a bounce (0 dead stop, 1 perfect bounce). */
  restitution: 0.4,
  /** Share of sideways speed lost in a bounce. */
  friction: 0.5,
  /** Below this speed, on a surface facing up, a casing comes to rest. */
  restSpeedMps: 0.7,
  /** How long a casing lasts, resting or not, before it is gone. */
  lifetimeSec: 5,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type CasingConfig = { -readonly [K in keyof typeof casingConfigDefaults]: number };
export const casingConfig: CasingConfig = { ...casingConfigDefaults };
