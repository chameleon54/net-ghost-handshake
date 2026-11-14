// Player grenades (milestone 2.9). All starting values, to be readjusted by feel. Units are in the names.
export const grenadeConfigDefaults = {
  /** Grenades carried at the start. Read once at start. Rook really starts with none (weapons.md): this is for testing, until looting exists (4.12). */
  startingGrenades: 2,
  /** The most that can be carried. Read once at start. */
  carryLimit: 2,
  /** From release to the blast. */
  fuseSec: 3,
  /** From pressing G to letting go. */
  windupSec: 0.35,
  /** After letting go, how long the hands stay busy before the weapon is drawn again. */
  followThroughSec: 0.25,
  /** How fast it leaves the hand, and how far above the view direction it is aimed. */
  throwSpeedMps: 14,
  throwUpRad: 0.15,

  // Ballistics: gravity and bouncing (no physics engine, see Grenade).
  gravityMps2: 9.8,
  /** Share of speed kept into a bounce (0 dead stop, 1 perfect bounce). */
  restitution: 0.45,
  /** Share of sideways speed lost in a bounce. */
  friction: 0.4,
  /** Below this speed, on a surface facing up, the grenade comes to rest. */
  restSpeedMps: 0.8,

  // The blast.
  blastRadiusM: 5,
  /** Damage at the centre, falling in a straight line to the edge damage at the edge of the radius. */
  damageAtCentre: 160,
  damageAtEdge: 20,
  /** How high above a target's feet the blast aims (its chest), and how far above the ground the blast is taken to start. */
  targetChestHeightM: 1,
  blastLiftM: 0.15,

  // What the player feels: the camera shakes, less with distance.
  shakeMaxRad: 0.08,
  shakeRadiusM: 15,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type GrenadeConfig = { -readonly [K in keyof typeof grenadeConfigDefaults]: number };
export const grenadeConfig: GrenadeConfig = { ...grenadeConfigDefaults };
