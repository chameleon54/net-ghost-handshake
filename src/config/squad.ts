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
  // How fast a flank goes is per role since 4.8 (src/config/roles.ts).
  /** Seen by Rook for this long on the way, the flank is called off. */
  spottedSec: 0.5,
  /** When the squad leader goes down, the squad is disorganised this long (decision 228)... */
  disorderSec: 6,
  /** ...with only this many firing slots... */
  disorderSlots: 1,
  /** ...and its members hold this many times longer between peeks. No flank starts meanwhile. */
  disorderHoldScale: 1.5,
  // Suppress and advance (4.9, decision 231)
  /** While Rook hides, a play starts at most this often: one moves up to closer cover while another pins his cover. */
  advanceEverySec: 10,
  /** With no advance spot or nobody to cover it, it tries again after this long. */
  playRetrySec: 2,
  /** An advance spot is at least this much closer to Rook than where the advancer is... */
  advanceMinGainM: 2,
  /** ...and no closer to him than this (a reposition spot too, decision 239). */
  advanceClosestM: 5,
  /** An advance or reposition route may have at most this much in Rook's view, even under covering fire (decision 239). */
  moveMaxExposedM: 6,
  /** Suppressing fire: rounds per burst, and the pause between bursts. */
  suppressBurstRounds: 8,
  suppressBurstPauseSec: 0.6,
  /** Suppressing fire aims this far to one side of where Rook hides (the edge of his cover). */
  suppressEdgeOffsetM: 0.6,
  /** A suppressor stays out at most this long... */
  suppressMaxSec: 8,
  /** ...and stops this long after the move it covers is over. */
  suppressAfterMoveSec: 1,
  /** Rook pins an enemy (the Suppressed state): a round of his passing or landing within this distance of it while it is out... */
  pinnedByFireM: 1,
  /** ...sends it back into cover, holding this many times longer. */
  pinnedHoldScale: 1.5,
  // Hearing Rook's weapon (4.10, decision 233)
  /** After the squad hears him run dry, reload or jam, it pushes this long later (if he is still vulnerable). */
  pushReactionSec: 1,
  /** A push window (dry, or jammed) stays open at most this long. */
  pushMaxWindowSec: 8,
  /** How many move up in a push: on a dry gun, on a reload, on a jam (a jam also starts a flank at once). */
  pushMoversDry: 2,
  pushMoversReload: 1,
  pushMoversJam: 1,
  // Repositioning (decision 237)
  /** A stand-in moves to another spot after this many peeks from one spot, at least... */
  repositionPeeksMin: 2,
  /** ...and at most (random in between, each time it arrives somewhere). */
  repositionPeeksMax: 4,
  /** Or after this many peeks in a row that saw nothing. */
  repositionBlindPeeks: 2,
  /** The new spot is at least this far from the old one. */
  repositionMinM: 3,
  /** Without covering fire it moves only if at most this much of its route is in Rook's view. */
  repositionMaxExposedM: 2,
  /** The flank attack (decision 227): on arrival it peeks at once and stays out firing for at most this long... */
  flankPressMaxSec: 6,
  /** ...or until it has not seen Rook for this long (or he hurts it). */
  flankPressLostSightSec: 1,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type SquadConfig = { -readonly [K in keyof typeof squadConfigDefaults]: number };
export const squadConfig: SquadConfig = { ...squadConfigDefaults };
