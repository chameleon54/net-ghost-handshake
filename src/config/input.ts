// Input tuning. Units are in the names.
export const inputConfig = {
  /** Camera turn per pixel of mouse movement. Starting value; becomes a player setting later. */
  mouseSensitivityRadPerPx: 0.0022,
  /** Up and down look limit, just short of straight up so the camera never flips. */
  pitchLimitRad: 1.5,
} as const;
