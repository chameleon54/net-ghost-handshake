// Player tuning. All starting values, to be readjusted by feel. Units are in the names.
export const playerConfigDefaults = {
  /** Half the width of the player's capsule. */
  capsuleRadiusM: 0.3,

  // Standing
  /** Feet to top of head, standing. */
  heightM: 1.8,
  /** Feet to camera, standing. */
  eyeHeightM: 1.65,
  /** Walking speed, in any direction. */
  moveSpeedMps: 4.0,
  /** Sprint speed. Sprinting only works while moving forward. */
  sprintSpeedMps: 6.5,

  // Crouching
  crouchHeightM: 1.2,
  crouchEyeHeightM: 1.05,
  crouchSpeedMps: 2.0,

  // Sliding
  slideHeightM: 0.9,
  slideEyeHeightM: 0.75,
  /** Speed at the start of a slide, falling in a straight line to the end speed. */
  slideStartSpeedMps: 8.0,
  slideEndSpeedMps: 3.0,
  slideDurationSec: 0.7,
  /** A new slide cannot start until this long after the last one ended. */
  slideCooldownSec: 1.0,
  /** Slowest the player may be moving when C is pressed for a slide to start. */
  slideEntrySpeedMps: 5.0,
  /** If real movement drops below this during a slide (a wall), the slide ends early. */
  slideBlockedSpeedMps: 1.5,
  /** How fast the slide direction may turn toward the keys held. A slight steer, not a turn. */
  slideSteerRateRadPerSec: 1.2,

  // Feel
  /** Camera height eases toward the stance's eye height with this time constant. It settles in about three times this. */
  eyeSmoothingTimeSec: 0.08,
  /** How fast speed builds while a key is held. 40 reaches walking speed in about 0.1 s. */
  accelerationMps2: 40,
  /** How fast speed drops when no key is held. */
  brakingMps2: 60,

  // Leaning
  /** How far the camera shifts sideways at full lean. The body stays put; only the head moves. */
  leanDistanceM: 0.45,
  /** Camera tilt at full lean (10 degrees). */
  leanRollRad: 0.175,
  /** Lean eases toward its target with this time constant. It settles in about three times this. */
  leanSmoothingTimeSec: 0.05,
  /**
   * Radius of the sphere the camera keeps clear of walls. It must be larger than how far the near plane reaches
   * sideways (about 0.09 m on a 16:9 screen, 0.11 m on 21:9, 0.15 m on 32:9), or you can see through a wall.
   */
  cameraClearanceM: 0.15,

  // Falling
  /** Gravity. A bit stronger than real life (9.8) so drops feel snappy. */
  gravityMps2: 20,
  /** Fastest the player can fall. */
  maxFallSpeedMps: 30,
  /** How much a capsule may overlap a surface and still count as clear (for standing up under things). */
  clearanceToleranceM: 0.02,

  // Climbing and vaulting (Space). Obstacle heights are measured from the player's feet.
  /** How far past the capsule's surface an obstacle can be and still be reachable. */
  mantleReachM: 0.45,
  /** Anything lower than this cannot be climbed (the capsule rolls over such small steps by itself). */
  mantleMinHeightM: 0.3,
  /** Up to this height an obstacle can be vaulted over. */
  vaultMaxHeightM: 1.1,
  /** Above this height nothing can be climbed. */
  climbMaxHeightM: 2.0,
  /** A vault is only possible over obstacles at most this deep. */
  vaultMaxDepthM: 1.0,
  /** Standing on top needs at least this much flat top, front to back. */
  climbMinTopDepthM: 0.6,
  /** How far apart the downward rays are when measuring an obstacle's depth. */
  mantleProbeStepM: 0.1,
  /** How far past the far edge the capsule's surface lands after a vault. */
  vaultLandingMarginM: 0.15,
  /** How far above the top the body rises while vaulting. */
  vaultApexClearanceM: 0.15,
  /** Vault: rise to the top, then over. About 0.4 s in total. */
  vaultRiseSec: 0.18,
  vaultOverSec: 0.22,
  /** Climbing onto a low obstacle (Space held): rise, then onto the top. About 0.4 s. */
  climbLowTopSec: 0.2,
  /** Climbing a tall ledge: a slow rise, then onto the top. About 0.7 s. */
  climbRiseSec: 0.45,
  climbTopSec: 0.25,

  // Collision and spawn
  /** How many times per update the player is pushed out of walls. More resolves tight corners. */
  collisionIterations: 5,
  /** Where the player starts, and which way they face (0 looks toward -Z). */
  startXM: 0,
  startZM: 4.5,
  startYawRad: 0,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type PlayerConfig = { -readonly [K in keyof typeof playerConfigDefaults]: number };
export const playerConfig: PlayerConfig = { ...playerConfigDefaults };
