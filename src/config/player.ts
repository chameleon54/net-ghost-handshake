// Player tuning. All starting values, to be readjusted by feel. Units are in the names.
export const playerConfig = {
  /** Half the width of the player's capsule. */
  capsuleRadiusM: 0.3,
  /** Feet to top of head, standing. */
  heightM: 1.8,
  /** Feet to camera, standing. */
  eyeHeightM: 1.65,
  /** Walking speed, in any direction. */
  moveSpeedMps: 4.0,
  /** How fast speed builds while a key is held. 40 reaches full speed in about 0.1 s. */
  accelerationMps2: 40,
  /** How fast speed drops when no key is held. */
  brakingMps2: 60,
  /** How many times per update the player is pushed out of walls. More resolves tight corners. */
  collisionIterations: 5,
  /** Where the player starts, and which way they face (0 looks toward -Z). */
  startXM: 0,
  startZM: 4.5,
  startYawRad: 0,
} as const;
