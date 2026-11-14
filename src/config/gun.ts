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
  /** Heat added by each shot (0 for a gun that does not heat). Heat runs from 0 to 100. */
  heatPerShot: number;
  heatCoolPerSec: number;
  /** After the last shot the gun waits this long before it starts to cool. */
  heatCoolDelaySec: number;
  /** Heat at which barrel smoke starts. */
  heatSmokeStart: number;
  /** Heat below which shots add no jam risk. */
  jamHeatStart: number;
  /**
   * Jam risk added by each shot at 100 heat (it rises smoothly from nothing at `jamHeatStart`). The risk builds up and
   * does not fall when the barrel cools: it goes back to 0 only when a jam happens (and clearing it resets the heat to 0).
   */
  jamRiskPerShotAtMaxHeat: number;
  /** The most jam risk can build up to. */
  jamRiskMax: number;
  /** A jam chance per shot that does not depend on heat (the pistol's rare one). */
  jamChanceFlat: number;
  /** No jam in this many first rounds fired from a magazine, and none for this long after clearing a jam. */
  jamFreeRounds: number;
  jamFreeAfterClearSec: number;
  /** Separate taps of R needed to clear a jam. */
  jamClearTaps: number;
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
