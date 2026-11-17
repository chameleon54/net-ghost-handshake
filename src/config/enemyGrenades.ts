// Enemy grenades (milestone 4.12, decision 249; enemies.md "Grenades"). Thrown to flush Rook out of cover, never to kill
// by surprise: always announced, with time to move. When the squad throws (after how long a hold, how often) is per
// aggression tier (aggression.ts); who carries one is per role (roles.ts). The blast is Rook's own (grenade.ts).
// Starting values. Units are in the names.
export const enemyGrenadeConfigDefaults = {
  // Who throws, and from where.
  /** A thrower is at least this far from Rook (horizontally)... */
  throwMinM: 4,
  /** ...and at most this far. */
  throwMaxM: 18,
  /** The grenade is aimed at a point up to this far from Rook's feet (random), not at him exactly. */
  throwScatterM: 1,
  /** It leaves the hand this far above the eyes of the peek it is thrown from. */
  throwHandAboveEyesM: 0.15,
  /** Throw angles tried, highest first (a lob over his cover), down to the lowest. */
  throwAngleMaxDeg: 60,
  throwAngleMinDeg: 30,
  /** No throw needs more than this speed. */
  throwSpeedMaxMps: 16,
  /** The flight counts as clear if the first thing it strikes is within this distance of where it is aimed. */
  throwLandToleranceM: 0.75,
  /** From the peek, the wind-up before it lets go: the player can shoot it meanwhile. */
  throwWindupSec: 0.5,
  /** If Rook has moved more than this since the throw was planned, it does not throw (never at a player on the move). */
  throwCancelMovedM: 1.5,
  /** When nobody can throw (no clear lob, out of range), the squad tries again after this long. */
  throwRetrySec: 3,

  // The grenade and its warnings.
  /** Its fuse, counted from when it first lands (Rook's own count from the throw, grenade.ts). */
  fuseSec: 3,
  /** The warning beep: this far apart in flight and when the fuse starts... */
  beepSlowSec: 0.5,
  /** ...getting closer together, to this, as the fuse runs out. */
  beepFastSec: 0.1,
  /** The trail behind it in flight lasts this long. */
  trailSec: 0.35,
  /** The HUD marker points at one while Rook is within the blast radius plus this. */
  warningExtraM: 2,
  /** The "Frag out!" line stays this long. */
  calloutShowSec: 2,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type EnemyGrenadeConfig = { -readonly [K in keyof typeof enemyGrenadeConfigDefaults]: number };
export const enemyGrenadeConfig: EnemyGrenadeConfig = { ...enemyGrenadeConfigDefaults };
