// Things lying on the floor to pick up (milestone 4.12, decision 249): what dead contractors drop (a grenade if they
// still carried one, and a magazine that fits Rook's guns). Picked up by walking over them (gameplay.md). Starting values.
export const pickupConfigDefaults = {
  /** Rook picks an item up when his feet come within this distance of it. */
  pickupRadiusM: 1,
  /** A body's drops lie this far either side of where it fell, so they do not overlap. */
  dropSpreadM: 0.35,
  /** The glow ring under an item pulses once every this long (drawing only). */
  glowPulseSec: 1.2,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type PickupConfig = { -readonly [K in keyof typeof pickupConfigDefaults]: number };
export const pickupConfig: PickupConfig = { ...pickupConfigDefaults };
