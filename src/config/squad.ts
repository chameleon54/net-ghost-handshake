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
  // Flanking (4.7, decision 225)
  /** Rook "holds a spot" while he stays within this distance of where he settled... */
  holdRadiusM: 2.5,
  /** ...and once he has held it this long (while the squad knows where he is), a flank is due. */
  holdBeforeFlankSec: 8,
  /** After a flank ends (arrived, spotted, or anything else), this long before the next can start. */
  flankWaitSec: 12,
  /** When nobody has a flank spot, it tries again after this long. */
  flankRetrySec: 2,
  /** A flank spot is at least this far round from where Rook looks (his side or rear). */
  flankMinAngleDeg: 60,
  /** At most this much of the route to a flank spot may be in Rook's view. */
  flankMaxExposedM: 4,
  /** A flanker moves this fast (its walk is slower). */
  flankSpeedMps: 3.5,
  /** Seen by Rook for this long on the way, the flank is called off. */
  spottedSec: 0.5,
  /** The flank attack (decision 227): on arrival it peeks at once and stays out firing for at most this long... */
  flankPressMaxSec: 6,
  /** ...or until it has not seen Rook for this long (or he hurts it). */
  flankPressLostSightSec: 1,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type SquadConfig = { -readonly [K in keyof typeof squadConfigDefaults]: number };
export const squadConfig: SquadConfig = { ...squadConfigDefaults };
