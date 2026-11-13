// Input tuning. Units are in the names.
export const inputConfigDefaults = {
  /** Camera turn per pixel of mouse movement. Starting value; becomes a player setting later. */
  mouseSensitivityRadPerPx: 0.0022,
  /** Up and down look limit, just short of straight up so the camera never flips. */
  pitchLimitRad: 1.5,
  /** A key held this long counts as a hold instead of a tap: R checks the magazine, F inspects the weapon. */
  holdTimeSec: 0.25,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type InputConfig = { -readonly [K in keyof typeof inputConfigDefaults]: number };
export const inputConfig: InputConfig = { ...inputConfigDefaults };
