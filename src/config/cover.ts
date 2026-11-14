// Cover tuning (milestone 4.3, decision 206): how a cover point is judged and chosen. Starting values. Units are in the names.
export const coverConfigDefaults = {
  /** Cover this far from Rook or more is liked (a trooper likes mid range, enemies.md). */
  preferMinM: 5,
  /** Cover this far from Rook or less is liked. */
  preferMaxM: 12,
  /** Score lost for each metre a spot is outside that range. */
  rangePenaltyPerM: 1,
  /** Score lost for each metre of walking to reach a spot, so a near spot wins over an equal far one. */
  walkPenaltyPerM: 0.3,
  /** Where the "is it hidden" rays aim on a body at a spot: its head centre, and its chest at this share of its height. */
  chestShareOfHeight: 0.6,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type CoverConfig = { -readonly [K in keyof typeof coverConfigDefaults]: number };
export const coverConfig: CoverConfig = { ...coverConfigDefaults };
