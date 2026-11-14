// The exposure meter and the deliberate-miss model (milestone 4.5, decision 220). All are starting values. Units are in
// the names. See gameplay.md "Exposure meter" and enemies.md "Shooting: deliberate misses".
export const exposureConfigDefaults = {
  /** The meter fills this much per second while an enemy sees all of Rook up close. 0 to full takes 1 / this. */
  fillPerSec: 0.4,
  /** It drops this much per second once Rook is behind cover. */
  drainPerSec: 1,
  /** With nobody seeing him, it holds (while he is still in view of where they last saw him from) at most this long. */
  holdMaxSec: 6,
  /** The fill is full speed up to this distance... */
  fullFillRangeM: 10,
  /** ...and falls to `farFillShare` at this distance and beyond. */
  farRangeM: 30,
  farFillShare: 0.4,
  /** Crouched, it fills at this share. */
  crouchFillShare: 0.7,
  /** Seen from beside or behind (more than 90 degrees from where he looks), it fills this many times faster. */
  sideFillScale: 1.5,
  /** Below this exposure every round misses. */
  hitStartExposure: 0.25,
  /** The hit chance at full exposure; it rises in a straight line from `hitStartExposure`. */
  maxHitChance: 0.8,
  /** Sprinting or sliding, the hit chance is this share (a moving target is hard to hit). */
  movingHitShare: 0.5,
  /** A miss passes this far from his chest at exposure 0... */
  missFarOffsetM: 1.5,
  /** ...and this far at full exposure, so impacts get closer as the meter fills. */
  missNearOffsetM: 0.3,
  /** A miss prefers to strike a surface within this distance of his chest (his cover). */
  missNearSurfaceM: 2,
  /** A round passing within this distance of his head, without stopping short of him, cracks. */
  crackRadiusM: 2,
  /** The crack's volume at exposure 0; it rises to full at exposure 1. */
  crackQuietVolume: 0.5,
  /** How often the enemies' view of Rook is measured for the meter. */
  checksPerSec: 10,
  // Shape. Not on the panel.
  /** The third point checked on Rook's body, about his hips: this share of his eye height. */
  hipHeightShareOfEyes: 0.45,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type ExposureConfig = { -readonly [K in keyof typeof exposureConfigDefaults]: number };
export const exposureConfig: ExposureConfig = { ...exposureConfigDefaults };
