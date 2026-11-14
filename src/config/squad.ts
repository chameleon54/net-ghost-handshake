// The squad coordinator (milestone 4.6, decision 223): firing slots and the shared hit budget. Starting values. Units are
// in the names. See enemies.md "Squad coordinator".
export const squadConfigDefaults = {
  /** At most this many enemies fire at the same time (3 at high aggression comes with the tiers, 4.11). */
  firingSlots: 2,
  /** The hit budget: at most one damaging hit on Rook within this window, from the whole squad. It never loosens. */
  hitGapSec: 0.5,
  /** A peek refused a slot stays in cover and asks again after this long. */
  slotRetrySec: 0.3,
  /** Dev testing aid: how many stand-ins are in the test room (1 to 4), from the next restart or Respawn. */
  standInCount: 4,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type SquadConfig = { -readonly [K in keyof typeof squadConfigDefaults]: number };
export const squadConfig: SquadConfig = { ...squadConfigDefaults };
