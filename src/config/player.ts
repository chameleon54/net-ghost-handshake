// Player tuning. All starting values, to be readjusted by feel. Units are in the names.
export const playerConfig = {
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
  /** Gap kept between the camera and a wall, so a lean never puts the camera inside it. */
  leanHeadClearanceM: 0.12,

  // Collision and spawn
  /** How many times per update the player is pushed out of walls. More resolves tight corners. */
  collisionIterations: 5,
  /** Where the player starts, and which way they face (0 looks toward -Z). */
  startXM: 0,
  startZM: 4.5,
  startYawRad: 0,
} as const;
