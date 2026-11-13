// Game loop tuning. Units are in the names.
export const loopConfig = {
  /** Game logic updates per second, whatever the screen's frame rate. Starting value. */
  updateRateHz: 60,
  /** Longest frame gap we simulate. A longer gap (slow tab, breakpoint) is cut to this so the game does not jump. */
  maxFrameGapSec: 0.25,
} as const;
