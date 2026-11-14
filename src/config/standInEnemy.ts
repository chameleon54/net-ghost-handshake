// Stand-in enemy tuning (milestone 4.1, decisions 197 to 201). A temporary enemy that walks at Rook and shoots, to prove
// damage, health and death; the real enemies replace it from 4.2. All are starting values. Units are in the names.
export const standInConfigDefaults = {
  /** Same as a trooper (enemies.md). Read when it (re)spawns. */
  healthPoints: 100,
  walkSpeedMps: 2.5,
  /** How fast it turns to face Rook. */
  turnSpeedDegPerSec: 360,
  /** It stops walking and fires once it can see Rook within this distance. */
  stopRangeM: 8,
  /** It never walks closer than this, even without sight, so it does not stand inside Rook. */
  closestM: 1,
  /** How often it plans a fresh route to Rook while walking (4.2). */
  repathIntervalSec: 0.5,
  /** How often it checks whether it can see Rook (perception does not run every update). */
  sightChecksPerSec: 5,
  /** Pause after it first gets sight before the first burst. */
  reactionSec: 0.5,
  /** It only fires when facing Rook within this angle. */
  aimToleranceDeg: 10,
  burstRounds: 3,
  roundIntervalSec: 0.1,
  burstPauseSec: 1.2,
  /** Chance that a round hits, 0 to 1. Flat until the exposure model (4.5). */
  hitChance: 0.3,
  /** The trooper's rifle (enemies.md). */
  damagePerHit: 15,
  /** The hit budget: at most one damaging hit within this window. It never loosens (enemies.md). */
  hitGapSec: 0.5,
  /** A miss passes this far from Rook's chest, at least and at most. */
  missMinOffsetM: 0.3,
  missMaxOffsetM: 1.5,
  fallTimeSec: 0.4,
  /** Time down before it gets up at its spawn spot, awake. */
  respawnDelaySec: 5,
  // Shape. Not on the panel. The body and head are the dummies' (dummyConfig).
  eyeHeightM: 1.6,
  muzzleHeightM: 1.35,
  /** How far in front of its body the gun's muzzle is. */
  muzzleForwardM: 0.5,
  /** Its collision capsule against walls and props. */
  capsuleRadiusM: 0.3,
  /** Where on Rook it aims and sees: this share of his eye height (about the chest). */
  aimHeightShareOfEyes: 0.75,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type StandInConfig = { -readonly [K in keyof typeof standInConfigDefaults]: number };
export const standInConfig: StandInConfig = { ...standInConfigDefaults };
