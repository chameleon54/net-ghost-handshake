// What every gun (rifle, pistol) needs in its config. The numbers live in config/rifle.ts and config/pistol.ts.
export interface GunConfig {
  /** Most rounds per minute. For a semi-automatic gun this caps how fast clicking can fire. */
  fireRateRpm: number;
  reloadTimeSec: number;
  /** Time after switching to this gun before it can fire or reload. */
  drawTimeSec: number;
  /** Rounds in a full magazine. Read once at start. */
  magazineRounds: number;
  /** Magazines carried at the start, including the loaded one. Read once at start. */
  startingMagazines: number;
  /** Extra time an empty reload takes: the rack that chambers a round. */
  emptyReloadRackSec: number;
  /** How long checking the magazine takes. Firing and reloading are blocked meanwhile. */
  checkMagazineSec: number;
  /** Damage of a body hit. A headshot always kills. */
  bodyDamagePerHit: number;
  /** Bullet scatter (half-angle of a cone) when not aiming, and when fully aimed down sights. */
  hipSpreadRad: number;
  aimedSpreadRad: number;
  /** Time to go from hip to fully aimed, and back. */
  aimTimeSec: number;
  /** Vertical field of view when fully aimed (zoomed in). */
  aimFovDeg: number;
  /** Walking speed and mouse turning, as a share of normal, when fully aimed. */
  aimMoveSpeedScale: number;
  aimSensitivityScale: number;
  recoilPitchPerShotRad: number;
  recoilMaxPitchRad: number;
  recoilYawPerShotRad: number;
  recoilMaxYawRad: number;
  recoilRecoveryDelaySec: number;
  recoilRecoveryRadPerSec: number;
}
