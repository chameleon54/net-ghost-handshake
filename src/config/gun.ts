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
  /** Damage of a body hit. A headshot always kills. */
  bodyDamagePerHit: number;
  recoilPitchPerShotRad: number;
  recoilMaxPitchRad: number;
  recoilYawPerShotRad: number;
  recoilMaxYawRad: number;
  recoilRecoveryDelaySec: number;
  recoilRecoveryRadPerSec: number;
}
