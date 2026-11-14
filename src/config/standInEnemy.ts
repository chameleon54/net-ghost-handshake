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
  /** How often it plans a fresh route while walking (4.2). */
  repathIntervalSec: 0.5,
  /** A walk has failed if no route is found, or it has not got closer to where it is going for this long (decision 219). */
  walkStuckSec: 1.5,
  /** How often it checks that its cover still hides it, and picks new cover if not (4.3). */
  coverCheckIntervalSec: 0.5,
  /** It has reached its cover spot within this distance. */
  coverArriveM: 0.25,
  /** Seen within this distance, it stands and fights instead of moving off (decision 209). */
  standGroundM: 8,
  /** Up close it fights this long (finishing its burst) before backing off to new cover. */
  fightSec: 2,
  /** Backing off to cover while firing, it moves at this share of its walk speed (decision 210). */
  retreatSpeedShare: 0.6,
  /** And its hit chance (from Rook's exposure, 4.5) is this share of the usual while it moves. */
  retreatHitChanceShare: 0.5,
  /** Peeks (4.4): in cover it holds between these many seconds (random each time) before peeking out. */
  peekHoldMinSec: 2.5,
  peekHoldMaxSec: 4.5,
  /** The tell before it comes out: a short wind-up movement and a sound, so the player can react. */
  tellSec: 0.5,
  /** How far out it moves during the tell, as a share of the whole peek. */
  tellShare: 0.2,
  /** Time to come out (rise over low cover, step past an edge of high cover), and to go back in. */
  peekOutSec: 0.25,
  peekBackSec: 0.25,
  /** How far it steps sideways out of high cover. */
  peekStepM: 0.6,
  /** How far it steps sideways out of low cover, staying crouched (decision 216). */
  crouchPeekStepM: 0.75,
  /** What it knows of Rook stays fresh this long; a peek fires at his cover only on fresh knowledge (decision 216). */
  memoryFreshSec: 10,
  /** Chance that a peek which finds Rook hidden fires its burst at his cover anyway, for pressure (decision 207). */
  hiddenFireChance: 0.5,
  /** Below this share of its health it is wounded: it stops standing its ground and pulls back to cover (decision 214). */
  woundedHealthShare: 0.4,
  /** Wounded, it holds this many times longer between peeks. */
  woundedHoldScale: 1.5,
  /** It runs from a grenade it can see within the blast radius plus this margin. */
  grenadeMarginM: 1,
  /** Time between seeing a grenade and running from it. */
  grenadeReactionSec: 0.4,
  /** How fast it runs from a grenade (faster than its walk). */
  grenadeRunSpeedMps: 4.5,
  /** It only runs to a cover point this close by walking; otherwise to open floor straight away from the grenade. */
  grenadeRunMaxM: 9,
  /** How often it checks whether it can see Rook (perception does not run every update). */
  sightChecksPerSec: 5,
  /** Pause after it first gets sight before the first burst. */
  reactionSec: 0.5,
  /** It only fires when facing Rook within this angle. */
  aimToleranceDeg: 10,
  burstRounds: 3,
  roundIntervalSec: 0.1,
  burstPauseSec: 1.2,
  /** The trooper's rifle (enemies.md). */
  damagePerHit: 15,
  fallTimeSec: 0.4,
  /** Time down before it gets up at its spawn spot, awake. */
  respawnDelaySec: 5,
  // Shape. Not on the panel. The body and head are the dummies' (dummyConfig).
  eyeHeightM: 1.6,
  muzzleHeightM: 1.35,
  /** Crouched behind low cover (4.3): its height (the head sits at the top), eyes and gun. */
  crouchHeightM: 1,
  crouchEyeHeightM: 0.85,
  crouchMuzzleHeightM: 0.7,
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
