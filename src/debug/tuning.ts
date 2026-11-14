import type { InputConfig } from '../config/input';
import type { PlayerConfig } from '../config/player';
import type { AudioConfig } from '../config/audio';
import type { CasingConfig } from '../config/casing';
import type { DummyConfig } from '../config/dummy';
import type { GrenadeConfig } from '../config/grenade';
import type { HealthConfig } from '../config/health';
import type { HealthFxConfig } from '../config/healthFx';
import type { KnifeConfig } from '../config/knife';
import type { MovementConfig } from '../config/movement';
import type { NoiseConfig } from '../config/noise';
import type { PistolConfig } from '../config/pistol';
import type { RifleConfig } from '../config/rifle';
import type { StandInConfig } from '../config/standInEnemy';
import type { CoverConfig } from '../config/cover';
import type { ViewmodelConfig } from '../config/viewmodel';

// What the tuning panel offers, and the pure helpers behind its buttons. No DOM here, so it can be tested.

export interface Slider<Key extends string> {
  key: Key;
  /** Shown on the panel, with the unit. */
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface Folder<Key extends string> {
  title: string;
  sliders: Slider<Key>[];
}

type PlayerKey = keyof PlayerConfig;
type InputKey = keyof InputConfig;
type RifleKey = keyof RifleConfig;
type DummyKey = keyof DummyConfig;
type PistolKey = keyof PistolConfig;
type KnifeKey = keyof KnifeConfig;
type ViewmodelKey = keyof ViewmodelConfig;
type CasingKey = keyof CasingConfig;
type AudioKey = keyof AudioConfig;
type GrenadeKey = keyof GrenadeConfig;
type NoiseKey = keyof NoiseConfig;
type HealthKey = keyof HealthConfig;
type MovementKey = keyof MovementConfig;
type HealthFxKey = keyof HealthFxConfig;
type StandInKey = keyof StandInConfig;
type CoverKey = keyof CoverConfig;

// Ranges stop obviously broken values: a crouch shorter than the capsule is wide (0.6 m), a reach of zero, and so on.
export const playerFolders: Folder<PlayerKey>[] = [
  {
    title: 'Walking',
    sliders: [
      { key: 'moveSpeedMps', label: 'Walk speed (m/s)', min: 1, max: 10, step: 0.1 },
      { key: 'accelerationMps2', label: 'Acceleration (m/s²)', min: 5, max: 100, step: 1 },
      { key: 'brakingMps2', label: 'Braking (m/s²)', min: 5, max: 150, step: 1 },
    ],
  },
  {
    title: 'Sprint, crouch and size',
    sliders: [
      { key: 'sprintSpeedMps', label: 'Sprint speed (m/s)', min: 2, max: 14, step: 0.1 },
      { key: 'crouchSpeedMps', label: 'Crouch speed (m/s)', min: 0.5, max: 6, step: 0.1 },
      { key: 'heightM', label: 'Standing height (m)', min: 1.4, max: 2.2, step: 0.01 },
      { key: 'eyeHeightM', label: 'Standing eye height (m)', min: 1.1, max: 2.1, step: 0.01 },
      { key: 'crouchHeightM', label: 'Crouch height (m)', min: 0.7, max: 1.7, step: 0.01 },
      { key: 'crouchEyeHeightM', label: 'Crouch eye height (m)', min: 0.6, max: 1.6, step: 0.01 },
    ],
  },
  {
    title: 'Slide',
    sliders: [
      { key: 'slideStartSpeedMps', label: 'Start speed (m/s)', min: 3, max: 16, step: 0.1 },
      { key: 'slideEndSpeedMps', label: 'End speed (m/s)', min: 0, max: 10, step: 0.1 },
      { key: 'slideDurationSec', label: 'Duration (s)', min: 0.2, max: 2, step: 0.01 },
      { key: 'slideCooldownSec', label: 'Cooldown (s)', min: 0, max: 5, step: 0.05 },
      { key: 'slideEntrySpeedMps', label: 'Needed speed to start (m/s)', min: 0, max: 8, step: 0.1 },
      { key: 'slideBlockedSpeedMps', label: 'Wall stops slide below (m/s)', min: 0.1, max: 4, step: 0.1 },
      { key: 'slideSteerRateRadPerSec', label: 'Steer rate (rad/s)', min: 0, max: 4, step: 0.05 },
      { key: 'slideHeightM', label: 'Slide height (m)', min: 0.7, max: 1.2, step: 0.01 },
      { key: 'slideEyeHeightM', label: 'Slide eye height (m)', min: 0.5, max: 1.1, step: 0.01 },
    ],
  },
  {
    title: 'Lean',
    sliders: [
      { key: 'leanDistanceM', label: 'Lean distance (m)', min: 0, max: 0.8, step: 0.01 },
      { key: 'leanRollRad', label: 'Lean tilt (rad)', min: 0, max: 0.5, step: 0.005 },
      { key: 'leanSmoothingTimeSec', label: 'Lean smoothing (s)', min: 0.01, max: 0.3, step: 0.005 },
      { key: 'cameraClearanceM', label: 'Camera clearance from walls (m)', min: 0.1, max: 0.3, step: 0.005 },
    ],
  },
  {
    title: 'Camera feel',
    sliders: [{ key: 'eyeSmoothingTimeSec', label: 'Crouch camera ease (s)', min: 0.01, max: 0.4, step: 0.005 }],
  },
  {
    title: 'Falling',
    sliders: [
      { key: 'gravityMps2', label: 'Gravity (m/s²)', min: 5, max: 50, step: 0.5 },
      // Above about 36 m/s a fall could skip through a thin surface (see src/level/collision.ts).
      { key: 'maxFallSpeedMps', label: 'Fastest fall (m/s)', min: 5, max: 36, step: 0.5 },
      { key: 'clearanceToleranceM', label: 'Overlap tolerance (m)', min: 0, max: 0.1, step: 0.005 },
    ],
  },
  {
    title: 'Climb and vault',
    sliders: [
      { key: 'mantleReachM', label: 'Reach (m)', min: 0.1, max: 1, step: 0.01 },
      { key: 'mantleMinHeightM', label: 'Smallest climb (m)', min: 0.1, max: 0.8, step: 0.01 },
      { key: 'vaultMaxHeightM', label: 'Highest vault (m)', min: 0.5, max: 1.5, step: 0.01 },
      { key: 'climbMaxHeightM', label: 'Highest climb (m)', min: 1, max: 3, step: 0.01 },
      { key: 'vaultMaxDepthM', label: 'Deepest vault (m)', min: 0.3, max: 2, step: 0.05 },
      { key: 'climbMinTopDepthM', label: 'Least top depth to stand (m)', min: 0.4, max: 1.5, step: 0.05 },
      { key: 'mantleProbeStepM', label: 'Depth probe step (m)', min: 0.05, max: 0.3, step: 0.01 },
      { key: 'vaultLandingMarginM', label: 'Vault landing margin (m)', min: 0, max: 0.5, step: 0.01 },
      { key: 'vaultMinSpeedMps', label: 'Vault: slowest crossing speed (m/s)', min: 1, max: 8, step: 0.1 },
      { key: 'vaultMinSec', label: 'Vault: shortest time (s)', min: 0.15, max: 1, step: 0.01 },
      { key: 'vaultMaxSec', label: 'Vault: longest time (s)', min: 0.2, max: 1.5, step: 0.01 },
      { key: 'vaultArcHeightM', label: 'Vault lift, highest obstacle (m)', min: 0, max: 0.8, step: 0.01 },
      { key: 'vaultArcMinHeightM', label: 'Vault lift, lowest obstacle (m)', min: 0, max: 0.8, step: 0.01 },
      { key: 'vaultHoldDecisionSec', label: 'Hold Space this long to climb (s)', min: 0.02, max: 0.4, step: 0.01 },
      { key: 'climbLowSec', label: 'Climb onto low cover (s)', min: 0.1, max: 1.5, step: 0.01 },
      { key: 'climbHighSec', label: 'Tall climb time (s)', min: 0.2, max: 2, step: 0.01 },
      { key: 'climbForwardLag', label: 'Climb: forward lag (1 = straight diagonal)', min: 1, max: 3, step: 0.05 },
    ],
  },
];

export const inputFolder: Folder<InputKey> = {
  title: 'Mouse',
  sliders: [
    { key: 'mouseSensitivityRadPerPx', label: 'Sensitivity (rad per pixel)', min: 0.0005, max: 0.008, step: 0.0001 },
    { key: 'pitchLimitRad', label: 'Look up and down limit (rad)', min: 0.5, max: 1.57, step: 0.01 },
    { key: 'holdTimeSec', label: 'Hold time for check or inspect (s)', min: 0.1, max: 0.8, step: 0.01 },
  ],
};

export const rifleFolders: Folder<RifleKey>[] = [
  {
    title: 'Rifle',
    sliders: [
      { key: 'fireRateRpm', label: 'Fire rate (rounds/min)', min: 100, max: 1500, step: 10 },
      { key: 'reloadTimeSec', label: 'Reload time (s)', min: 0.3, max: 5, step: 0.05 },
      { key: 'emptyReloadRackSec', label: 'Extra time for an empty reload (s)', min: 0, max: 2, step: 0.05 },
      { key: 'checkMagazineSec', label: 'Check magazine time (s)', min: 0.3, max: 3, step: 0.05 },
      { key: 'drawTimeSec', label: 'Draw time (s)', min: 0.05, max: 2, step: 0.05 },
      { key: 'bodyDamagePerHit', label: 'Body damage per hit', min: 1, max: 200, step: 1 },
      { key: 'maxRangeM', label: 'Bullet range (m)', min: 10, max: 300, step: 5 },
    ],
  },
  {
    title: 'Rifle aiming',
    sliders: [
      { key: 'hipSpreadRad', label: 'Hip spread (rad)', min: 0, max: 0.1, step: 0.001 },
      { key: 'aimedSpreadRad', label: 'Aimed spread (rad)', min: 0, max: 0.05, step: 0.0005 },
      { key: 'aimTimeSec', label: 'Time to aim (s)', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'aimFovDeg', label: 'Aimed field of view (deg)', min: 20, max: 90, step: 1 },
      { key: 'aimMoveSpeedScale', label: 'Aimed walking speed (share)', min: 0.1, max: 1, step: 0.05 },
      { key: 'aimSensitivityScale', label: 'Aimed turning (share)', min: 0.1, max: 1.5, step: 0.05 },
    ],
  },
  {
    title: 'Rifle heat and jams',
    sliders: [
      { key: 'heatPerShot', label: 'Heat per shot', min: 0, max: 30, step: 0.5 },
      { key: 'heatCoolPerSec', label: 'Cooling (heat per s)', min: 1, max: 80, step: 1 },
      { key: 'heatCoolDelaySec', label: 'Cooling starts after (s)', min: 0, max: 3, step: 0.05 },
      { key: 'heatSmokeStart', label: 'Smoke from heat', min: 0, max: 100, step: 1 },
      { key: 'jamHeatStart', label: 'Shots add jam risk from heat', min: 0, max: 99, step: 1 },
      { key: 'jamRiskPerShotAtMaxHeat', label: 'Jam risk added per shot at 100 heat', min: 0, max: 0.05, step: 0.0005 },
      { key: 'jamRiskMax', label: 'Most jam risk that builds up', min: 0, max: 1, step: 0.01 },
      { key: 'jamChanceFlat', label: 'Jam chance per shot, flat', min: 0, max: 0.05, step: 0.0005 },
      { key: 'jamFreeRounds', label: 'No jam in a magazine\'s first rounds', min: 0, max: 30, step: 1 },
      { key: 'jamFreeAfterClearSec', label: 'No jam for this long after clearing (s)', min: 0, max: 30, step: 0.5 },
      { key: 'jamClearTaps', label: 'Taps of R to clear a jam', min: 1, max: 10, step: 1 },
    ],
  },
  {
    title: 'Rifle recoil',
    sliders: [
      { key: 'recoilPitchPerShotRad', label: 'Kick up per shot (rad)', min: 0, max: 0.05, step: 0.001 },
      { key: 'recoilMaxPitchRad', label: 'Most kick up (rad)', min: 0, max: 0.5, step: 0.005 },
      { key: 'recoilYawPerShotRad', label: 'Sideways kick per shot (rad)', min: 0, max: 0.02, step: 0.0005 },
      { key: 'recoilMaxYawRad', label: 'Most sideways kick (rad)', min: 0, max: 0.2, step: 0.005 },
      { key: 'recoilRecoveryDelaySec', label: 'Settle delay after last shot (s)', min: 0, max: 0.5, step: 0.01 },
      { key: 'recoilRecoveryRadPerSec', label: 'Settle speed (rad/s)', min: 0.05, max: 3, step: 0.05 },
    ],
  },
  {
    title: 'Rifle effects',
    sliders: [
      { key: 'tracerSpeedMps', label: 'Tracer speed (m/s)', min: 50, max: 1000, step: 10 },
      { key: 'tracerLengthM', label: 'Tracer length (m)', min: 0.5, max: 20, step: 0.5 },
      { key: 'markRadiusM', label: 'Bullet mark radius (m)', min: 0.01, max: 0.2, step: 0.005 },
    ],
  },
];

export const pistolFolders: Folder<PistolKey>[] = [
  {
    title: 'Pistol',
    sliders: [
      { key: 'fireRateRpm', label: 'Fastest clicking (rounds/min)', min: 100, max: 1500, step: 10 },
      { key: 'reloadTimeSec', label: 'Reload time (s)', min: 0.3, max: 5, step: 0.05 },
      { key: 'emptyReloadRackSec', label: 'Extra time for an empty reload (s)', min: 0, max: 2, step: 0.05 },
      { key: 'checkMagazineSec', label: 'Check magazine time (s)', min: 0.3, max: 3, step: 0.05 },
      { key: 'drawTimeSec', label: 'Draw time (s)', min: 0.05, max: 2, step: 0.05 },
      { key: 'bodyDamagePerHit', label: 'Body damage per hit', min: 1, max: 200, step: 1 },
    ],
  },
  {
    title: 'Pistol aiming',
    sliders: [
      { key: 'hipSpreadRad', label: 'Hip spread (rad)', min: 0, max: 0.1, step: 0.001 },
      { key: 'aimedSpreadRad', label: 'Aimed spread (rad)', min: 0, max: 0.05, step: 0.0005 },
      { key: 'aimTimeSec', label: 'Time to aim (s)', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'aimFovDeg', label: 'Aimed field of view (deg)', min: 20, max: 90, step: 1 },
      { key: 'aimMoveSpeedScale', label: 'Aimed walking speed (share)', min: 0.1, max: 1, step: 0.05 },
      { key: 'aimSensitivityScale', label: 'Aimed turning (share)', min: 0.1, max: 1.5, step: 0.05 },
    ],
  },
  {
    title: 'Pistol jams',
    sliders: [
      { key: 'heatPerShot', label: 'Heat per shot', min: 0, max: 30, step: 0.5 },
      { key: 'heatCoolPerSec', label: 'Cooling (heat per s)', min: 1, max: 80, step: 1 },
      { key: 'heatCoolDelaySec', label: 'Cooling starts after (s)', min: 0, max: 3, step: 0.05 },
      { key: 'heatSmokeStart', label: 'Smoke from heat', min: 0, max: 100, step: 1 },
      { key: 'jamHeatStart', label: 'Shots add jam risk from heat', min: 0, max: 99, step: 1 },
      { key: 'jamRiskPerShotAtMaxHeat', label: 'Jam risk added per shot at 100 heat', min: 0, max: 0.05, step: 0.0005 },
      { key: 'jamRiskMax', label: 'Most jam risk that builds up', min: 0, max: 1, step: 0.01 },
      { key: 'jamChanceFlat', label: 'Jam chance per shot, flat', min: 0, max: 0.05, step: 0.0005 },
      { key: 'jamFreeRounds', label: 'No jam in a magazine\'s first rounds', min: 0, max: 30, step: 1 },
      { key: 'jamFreeAfterClearSec', label: 'No jam for this long after clearing (s)', min: 0, max: 30, step: 0.5 },
      { key: 'jamClearTaps', label: 'Taps of R to clear a jam', min: 1, max: 10, step: 1 },
    ],
  },
  {
    title: 'Pistol recoil',
    sliders: [
      { key: 'recoilPitchPerShotRad', label: 'Kick up per shot (rad)', min: 0, max: 0.1, step: 0.001 },
      { key: 'recoilMaxPitchRad', label: 'Most kick up (rad)', min: 0, max: 0.5, step: 0.005 },
      { key: 'recoilYawPerShotRad', label: 'Sideways kick per shot (rad)', min: 0, max: 0.02, step: 0.0005 },
      { key: 'recoilMaxYawRad', label: 'Most sideways kick (rad)', min: 0, max: 0.2, step: 0.005 },
      { key: 'recoilRecoveryDelaySec', label: 'Settle delay after last shot (s)', min: 0, max: 0.5, step: 0.01 },
      { key: 'recoilRecoveryRadPerSec', label: 'Settle speed (rad/s)', min: 0.05, max: 3, step: 0.05 },
    ],
  },
];

/** Pistol config values that are deliberately not on the panel: they are read once when the game starts. */
export const pistolKeysNotOnPanel: readonly PistolKey[] = ['magazineRounds', 'startingMagazines'];

/** Weapon animation numbers. Slow motion is not here: it has its own slider next to the preview buttons. */
export const viewmodelFolders: Folder<ViewmodelKey>[] = [
  {
    title: 'Kick and slide',
    sliders: [
      { key: 'kickFrequencyHz', label: 'Spring speed (Hz)', min: 4, max: 40, step: 0.5 },
      { key: 'kickDampingRatio', label: 'Spring damping (1 = no overshoot)', min: 0.1, max: 1.5, step: 0.05 },
      { key: 'rifleKickBackM', label: 'Rifle kick back (m)', min: 0, max: 0.1, step: 0.005 },
      { key: 'rifleKickUpRad', label: 'Rifle muzzle flip (rad)', min: 0, max: 0.3, step: 0.005 },
      { key: 'pistolKickBackM', label: 'Pistol kick back (m)', min: 0, max: 0.1, step: 0.005 },
      { key: 'pistolKickUpRad', label: 'Pistol muzzle flip (rad)', min: 0, max: 0.4, step: 0.005 },
      { key: 'rifleBoltBackM', label: 'Rifle bolt travel (m)', min: 0, max: 0.1, step: 0.005 },
      { key: 'pistolSlideBackM', label: 'Pistol slide travel (m)', min: 0, max: 0.1, step: 0.005 },
      { key: 'slideBackSec', label: 'Slide back time (s)', min: 0.01, max: 0.2, step: 0.005 },
      { key: 'slideForwardSec', label: 'Slide forward time (s)', min: 0.01, max: 0.3, step: 0.005 },
    ],
  },
  {
    title: 'Draw and sprint pose',
    sliders: [
      { key: 'drawLowerM', label: 'Draw: start this far down (m)', min: 0, max: 0.6, step: 0.01 },
      { key: 'drawTiltRad', label: 'Draw: start tilted (rad)', min: 0, max: 1.5, step: 0.05 },
      { key: 'drawOvershoot', label: 'Draw: overshoot', min: 0, max: 4, step: 0.1 },
      { key: 'sprintPoseTimeSec', label: 'Sprint pose time (s)', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'sprintOffsetXM', label: 'Sprint: right (m)', min: -0.2, max: 0.2, step: 0.005 },
      { key: 'sprintOffsetYM', label: 'Sprint: up (m)', min: -0.3, max: 0.1, step: 0.005 },
      { key: 'sprintOffsetZM', label: 'Sprint: toward you (m)', min: -0.2, max: 0.2, step: 0.005 },
      { key: 'sprintPitchRad', label: 'Sprint: muzzle up (rad)', min: -1, max: 1, step: 0.05 },
      { key: 'sprintYawRad', label: 'Sprint: muzzle left (rad)', min: -1, max: 1, step: 0.05 },
      { key: 'sprintRollRad', label: 'Sprint: roll (rad)', min: -1, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Reload and knife',
    sliders: [
      { key: 'magDropM', label: 'Magazine drop (m)', min: 0.05, max: 0.6, step: 0.01 },
      { key: 'handDipM', label: 'Off hand dip (m)', min: 0.05, max: 0.6, step: 0.01 },
      { key: 'reloadTiltRad', label: 'Gun tilt in a reload (rad)', min: 0, max: 0.8, step: 0.01 },
      { key: 'knifeSlashSec', label: 'Knife slash time (s)', min: 0.05, max: 0.6, step: 0.01 },
    ],
  },
  {
    title: 'Jam rack and smoke',
    sliders: [
      { key: 'rackTapSec', label: 'Rack per tap (s)', min: 0.05, max: 0.6, step: 0.01 },
      { key: 'jammedSlideShare', label: 'Jammed slide position (share)', min: 0, max: 1, step: 0.05 },
      { key: 'smokeEverySecAtStart', label: 'Smoke: puff every (s), just warm', min: 0.05, max: 2, step: 0.05 },
      { key: 'smokeEverySecAtMaxHeat', label: 'Smoke: puff every (s), at 100 heat', min: 0.02, max: 1, step: 0.01 },
      { key: 'smokeLifeSec', label: 'Smoke: lasts (s)', min: 0.2, max: 4, step: 0.1 },
      { key: 'smokeRiseMps', label: 'Smoke: rises (m/s)', min: 0, max: 1.5, step: 0.05 },
      { key: 'smokeSizeM', label: 'Smoke: starting size (m)', min: 0.005, max: 0.15, step: 0.005 },
      { key: 'smokeGrowth', label: 'Smoke: growth (times)', min: 1, max: 8, step: 0.5 },
      { key: 'smokeOpacity', label: 'Smoke: opacity', min: 0.05, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Check, inspect and walking',
    sliders: [
      { key: 'checkMagPullM', label: 'Check: magazine slides out (m)', min: 0, max: 0.15, step: 0.005 },
      { key: 'checkLiftUpM', label: 'Check: magazine lifted up (m)', min: 0, max: 0.4, step: 0.01 },
      { key: 'checkLiftSideM', label: 'Check: magazine moved left (m)', min: -0.1, max: 0.3, step: 0.01 },
      { key: 'checkLiftTowardM', label: 'Check: magazine toward the camera (m)', min: -0.1, max: 0.3, step: 0.01 },
      { key: 'checkMagTiltRad', label: 'Check: magazine tipped toward the camera (rad)', min: 0, max: 2, step: 0.05 },
      { key: 'checkMagRollRad', label: 'Check: magazine leaned to the left (rad)', min: -1, max: 1, step: 0.05 },
      { key: 'checkRollRad', label: 'Check: gun roll (rad)', min: 0, max: 1, step: 0.01 },
      { key: 'magPictureOffsetXM', label: 'Check picture: right of the magazine (m)', min: -0.3, max: 0.3, step: 0.01 },
      { key: 'magPictureOffsetYM', label: 'Check picture: above the magazine (m)', min: -0.3, max: 0.3, step: 0.01 },
      { key: 'inspectGunSec', label: 'Inspect a gun (s)', min: 0.5, max: 6, step: 0.1 },
      { key: 'inspectKnifeSec', label: 'Inspect the knife (s)', min: 0.5, max: 6, step: 0.1 },
      { key: 'bobStrideM', label: 'Bob: one cycle every (m)', min: 0.5, max: 8, step: 0.1 },
      { key: 'bobSideM', label: 'Bob: sideways (m)', min: 0, max: 0.03, step: 0.001 },
      { key: 'bobUpM', label: 'Bob: up and down (m)', min: 0, max: 0.03, step: 0.001 },
      { key: 'bobReferenceSpeedMps', label: 'Bob: full at this speed (m/s)', min: 1, max: 8, step: 0.1 },
      { key: 'bobCrouchScale', label: 'Bob: crouched (share)', min: 0, max: 1, step: 0.05 },
      { key: 'bobAimScale', label: 'Bob: aiming (share)', min: 0, max: 1, step: 0.05 },
      { key: 'swayGain', label: 'Sway: strength', min: 0, max: 400, step: 5 },
      { key: 'swayFrequencyHz', label: 'Sway: spring speed (Hz)', min: 1, max: 30, step: 0.5 },
      { key: 'swayDampingRatio', label: 'Sway: damping (1 = no overshoot)', min: 0.1, max: 1.5, step: 0.05 },
      { key: 'swayMaxRad', label: 'Sway: most lag (rad)', min: 0, max: 0.2, step: 0.005 },
      { key: 'swayAimScale', label: 'Sway: aiming (share)', min: 0, max: 1, step: 0.05 },
    ],
  },
];

/** Viewmodel config values that are deliberately not in those folders. */
export const viewmodelKeysNotOnPanel: readonly ViewmodelKey[] = ['slowMotionScale']; // next to the preview buttons

export const movementFolder: Folder<MovementKey> = {
  title: 'Movement sounds',
  sliders: [
    { key: 'stepEveryWalkM', label: 'Step spacing, walking (m)', min: 0.5, max: 4, step: 0.1 },
    { key: 'stepEveryCrouchM', label: 'Step spacing, crouching (m)', min: 0.5, max: 4, step: 0.1 },
    { key: 'stepEverySprintM', label: 'Step spacing, sprinting (m)', min: 0.5, max: 5, step: 0.1 },
    { key: 'stepVolumeWalk', label: 'Footstep volume, walking', min: 0, max: 1.5, step: 0.05 },
    { key: 'stepVolumeCrouch', label: 'Footstep volume, crouching', min: 0, max: 1.5, step: 0.05 },
    { key: 'stepVolumeSprint', label: 'Footstep volume, sprinting', min: 0, max: 1.5, step: 0.05 },
    { key: 'footPitchShare', label: 'Left and right foot pitch apart', min: 0, max: 0.15, step: 0.005 },
    { key: 'slideVolume', label: 'Slide volume', min: 0, max: 1.5, step: 0.05 },
    { key: 'vaultVolume', label: 'Vault volume', min: 0, max: 1.5, step: 0.05 },
    { key: 'climbVolume', label: 'Climb volume', min: 0, max: 1.5, step: 0.05 },
    { key: 'landMinSpeedMps', label: 'Landings slower than this are silent (m/s)', min: 1, max: 9, step: 0.5 },
    { key: 'landSoftMinVolume', label: 'Quietest landing volume', min: 0, max: 1, step: 0.05 },
  ],
};

export const noiseFolder: Folder<NoiseKey> = {
  title: 'Noise (how far enemies hear)',
  sliders: [
    { key: 'rifleShotM', label: 'M4-A shot (m)', min: 0, max: 100, step: 1 },
    { key: 'pistolShotM', label: 'P9 shot, suppressed (m)', min: 0, max: 50, step: 0.5 },
    { key: 'impactM', label: 'Bullet hitting a surface (m)', min: 0, max: 60, step: 1 },
    { key: 'emptyClickM', label: 'Empty click (m)', min: 0, max: 40, step: 1 },
    { key: 'reloadM', label: 'Starting a reload (m)', min: 0, max: 40, step: 1 },
    { key: 'jamM', label: 'A jam (m)', min: 0, max: 40, step: 1 },
    { key: 'jamClickM', label: 'Dead click when jammed (m)', min: 0, max: 40, step: 1 },
    { key: 'rackM', label: 'Rack while clearing a jam (m)', min: 0, max: 40, step: 1 },
    { key: 'knifeSwingM', label: 'Knife swing (m)', min: 0, max: 20, step: 0.5 },
    { key: 'knifeStabM', label: 'Knife stab (m)', min: 0, max: 20, step: 0.5 },
    { key: 'grenadeBounceM', label: 'Grenade bounce (m)', min: 0, max: 40, step: 1 },
    { key: 'grenadeBlastM', label: 'Grenade blast (m)', min: 0, max: 200, step: 5 },
    { key: 'walkStepM', label: 'Footstep, walking (m)', min: 0, max: 40, step: 0.5 },
    { key: 'crouchStepM', label: 'Footstep, crouching (m)', min: 0, max: 40, step: 0.5 },
    { key: 'sprintStepM', label: 'Footstep, sprinting (m)', min: 0, max: 60, step: 0.5 },
    { key: 'slideM', label: 'Slide (m)', min: 0, max: 40, step: 0.5 },
    { key: 'vaultM', label: 'Vault (m)', min: 0, max: 40, step: 0.5 },
    { key: 'climbM', label: 'Climb (m)', min: 0, max: 40, step: 0.5 },
    { key: 'landingSoftM', label: 'Landing, light (m)', min: 0, max: 40, step: 0.5 },
    { key: 'landingHardM', label: 'Landing, hard fall (m)', min: 0, max: 60, step: 0.5 },
  ],
};

export const grenadeFolder: Folder<GrenadeKey> = {
  title: 'Grenades',
  sliders: [
    { key: 'fuseSec', label: 'Fuse (s)', min: 0.5, max: 8, step: 0.1 },
    { key: 'windupSec', label: 'Wind-up (s)', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'followThroughSec', label: 'Follow-through (s)', min: 0.05, max: 1, step: 0.05 },
    { key: 'throwSpeedMps', label: 'Throw speed (m/s)', min: 3, max: 30, step: 0.5 },
    { key: 'throwUpRad', label: 'Aimed above view (rad)', min: 0, max: 0.8, step: 0.01 },
    { key: 'gravityMps2', label: 'Gravity (m/s²)', min: 1, max: 30, step: 0.5 },
    { key: 'restitution', label: 'Bounce (share of speed kept)', min: 0, max: 0.9, step: 0.05 },
    { key: 'friction', label: 'Sideways speed lost in a bounce', min: 0, max: 1, step: 0.05 },
    { key: 'restSpeedMps', label: 'Comes to rest below (m/s)', min: 0.1, max: 3, step: 0.1 },
    { key: 'blastRadiusM', label: 'Blast radius (m)', min: 1, max: 15, step: 0.5 },
    { key: 'damageAtCentre', label: 'Damage at the centre', min: 1, max: 500, step: 5 },
    { key: 'damageAtEdge', label: 'Damage at the edge', min: 0, max: 500, step: 5 },
    { key: 'targetChestHeightM', label: 'Blast aims this high (m)', min: 0.3, max: 1.6, step: 0.05 },
    { key: 'targetChestShareOfHeight', label: 'On a crouched target, at most (share of height)', min: 0.2, max: 1, step: 0.05 },
    { key: 'blastLiftM', label: 'Blast starts this far up (m)', min: 0, max: 0.6, step: 0.05 },
    { key: 'shakeMaxRad', label: 'Camera shake, closest (rad)', min: 0, max: 0.2, step: 0.005 },
    { key: 'shakeRadiusM', label: 'Camera shake reaches (m)', min: 1, max: 40, step: 1 },
  ],
};

/** Grenade values that are deliberately not on the panel: they are read once when the game starts. */
export const grenadeKeysNotOnPanel: readonly GrenadeKey[] = ['startingGrenades', 'carryLimit'];

export const audioFolder: Folder<AudioKey> = {
  title: 'Audio',
  sliders: [
    { key: 'masterVolume', label: 'Master volume', min: 0, max: 1.5, step: 0.05 },
    { key: 'weaponVolume', label: 'Gunshots and stabs', min: 0, max: 1.5, step: 0.05 },
    { key: 'handlingVolume', label: 'Handling (clicks, racks, magazines)', min: 0, max: 1.5, step: 0.05 },
    { key: 'movementVolume', label: 'Movement (footsteps, slide, vault, climb)', min: 0, max: 1.5, step: 0.05 },
    { key: 'impactVolume', label: 'Impacts, hit ticks, casings', min: 0, max: 1.5, step: 0.05 },
    { key: 'pistolLoudness', label: 'Pistol loudness (share of rifle)', min: 0, max: 1, step: 0.05 },
    { key: 'rattleStartHeat', label: 'Hot-barrel rattle from heat', min: 0, max: 100, step: 1 },
    { key: 'earRingingVolume', label: 'Ringing ears volume (0 = none yet)', min: 0, max: 1.5, step: 0.05 },
    { key: 'earRingingDuckShare', label: 'Ringing ears lower other sounds by', min: 0, max: 1, step: 0.05 },
    { key: 'earRingingRadiusM', label: 'Blast rings the ears within (m)', min: 0, max: 20, step: 0.5 },
    { key: 'earRingingMaxSec', label: 'Ringing lasts at most (s)', min: 0.5, max: 10, step: 0.5 },
    { key: 'pitchVariation', label: 'Pitch variation (share)', min: 0, max: 0.2, step: 0.005 },
    { key: 'casingClinkMinGapSec', label: 'Casing clinks at most every (s)', min: 0, max: 0.5, step: 0.01 },
  ],
};

export const casingFolder: Folder<CasingKey> = {
  title: 'Casings',
  sliders: [
    { key: 'ejectSpeedMps', label: 'Eject speed, sideways (m/s)', min: 0, max: 8, step: 0.1 },
    { key: 'ejectUpMps', label: 'Eject speed, up (m/s)', min: 0, max: 8, step: 0.1 },
    { key: 'ejectSpreadMps', label: 'Random extra speed (m/s)', min: 0, max: 3, step: 0.1 },
    { key: 'gravityMps2', label: 'Gravity (m/s²)', min: 1, max: 30, step: 0.5 },
    { key: 'restitution', label: 'Bounce (share of speed kept)', min: 0, max: 0.9, step: 0.05 },
    { key: 'friction', label: 'Sideways speed lost in a bounce', min: 0, max: 1, step: 0.05 },
    { key: 'restSpeedMps', label: 'Comes to rest below (m/s)', min: 0.1, max: 3, step: 0.1 },
    { key: 'lifetimeSec', label: 'Lasts (s)', min: 1, max: 20, step: 0.5 },
  ],
};

export const knifeFolder: Folder<KnifeKey> = {
  title: 'Knife',
  sliders: [
    { key: 'reachM', label: 'Reach (m)', min: 0.5, max: 3, step: 0.05 },
    { key: 'swingCooldownSec', label: 'Time between swings (s)', min: 0.1, max: 2, step: 0.05 },
    { key: 'drawTimeSec', label: 'Draw time (s)', min: 0.05, max: 2, step: 0.05 },
    { key: 'frontDamagePerHit', label: 'Damage from the front', min: 1, max: 200, step: 1 },
  ],
};

export const dummyFolder: Folder<DummyKey> = {
  title: 'Target dummies',
  sliders: [
    { key: 'healthPoints', label: 'Health (from next stand-up)', min: 1, max: 500, step: 1 },
    { key: 'fallTimeSec', label: 'Fall time (s)', min: 0.05, max: 2, step: 0.05 },
    { key: 'respawnDelaySec', label: 'Time down before standing (s)', min: 0.5, max: 20, step: 0.5 },
  ],
};

export const standInFolder: Folder<StandInKey> = {
  title: 'Stand-in enemy',
  sliders: [
    { key: 'healthPoints', label: 'Health (from next spawn)', min: 1, max: 500, step: 1 },
    { key: 'walkSpeedMps', label: 'Walk speed (m/s)', min: 0, max: 8, step: 0.1 },
    { key: 'turnSpeedDegPerSec', label: 'Turn speed (deg/s)', min: 30, max: 1080, step: 10 },
    { key: 'stopRangeM', label: 'Stops to fire within (m)', min: 1, max: 30, step: 0.5 },
    { key: 'closestM', label: 'Never closer than (m)', min: 0.5, max: 5, step: 0.1 },
    { key: 'repathIntervalSec', label: 'Plans a fresh route every (s)', min: 0.1, max: 3, step: 0.1 },
    { key: 'walkStuckSec', label: 'Gives up a walk with no progress after (s)', min: 0.2, max: 10, step: 0.1 },
    { key: 'coverCheckIntervalSec', label: 'Checks its cover every (s)', min: 0.1, max: 3, step: 0.1 },
    { key: 'coverArriveM', label: 'At its cover within (m)', min: 0.05, max: 1, step: 0.05 },
    { key: 'standGroundM', label: 'Stands and fights within (m)', min: 0, max: 30, step: 0.5 },
    { key: 'fightSec', label: 'Fights up close for (s)', min: 0, max: 10, step: 0.1 },
    { key: 'retreatSpeedShare', label: 'Backing off: speed (share of walk)', min: 0.1, max: 1, step: 0.05 },
    { key: 'retreatHitChanceShare', label: 'Backing off: hit chance (share)', min: 0, max: 1, step: 0.05 },
    { key: 'peekHoldMinSec', label: 'Peek: holds at least (s)', min: 0.2, max: 15, step: 0.1 },
    { key: 'peekHoldMaxSec', label: 'Peek: holds at most (s)', min: 0.2, max: 20, step: 0.1 },
    { key: 'tellSec', label: 'Peek: tell lasts (s)', min: 0, max: 2, step: 0.05 },
    { key: 'tellShare', label: 'Peek: tell moves out (share)', min: 0, max: 0.8, step: 0.05 },
    { key: 'peekOutSec', label: 'Peek: comes out in (s)', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'peekBackSec', label: 'Peek: goes back in (s)', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'peekStepM', label: 'Peek: steps out from high cover (m)', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'crouchPeekStepM', label: 'Peek: steps out crouched from low cover (m)', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'memoryFreshSec', label: 'Fires at your cover only if it knew within (s)', min: 0, max: 30, step: 0.5 },
    { key: 'hiddenFireChance', label: 'Peek: fires at your cover when hidden (0 to 1)', min: 0, max: 1, step: 0.05 },
    { key: 'woundedHealthShare', label: 'Wounded below (share of health)', min: 0, max: 1, step: 0.05 },
    { key: 'woundedHoldScale', label: 'Wounded: holds longer between peeks (x)', min: 1, max: 5, step: 0.1 },
    { key: 'grenadeMarginM', label: 'Grenade: runs within blast radius plus (m)', min: 0, max: 5, step: 0.25 },
    { key: 'grenadeReactionSec', label: 'Grenade: reacts after (s)', min: 0, max: 2, step: 0.05 },
    { key: 'grenadeRunSpeedMps', label: 'Grenade: runs at (m/s)', min: 1, max: 10, step: 0.1 },
    { key: 'grenadeRunMaxM', label: 'Grenade: runs to cover at most (m of walking)', min: 1, max: 30, step: 0.5 },
    { key: 'sightChecksPerSec', label: 'Sight checks per s', min: 1, max: 30, step: 1 },
    { key: 'reactionSec', label: 'Reaction before firing (s)', min: 0, max: 3, step: 0.05 },
    { key: 'aimToleranceDeg', label: 'Fires when facing within (deg)', min: 1, max: 90, step: 1 },
    { key: 'burstRounds', label: 'Rounds per burst', min: 1, max: 10, step: 1 },
    { key: 'roundIntervalSec', label: 'Time between rounds (s)', min: 0.03, max: 1, step: 0.01 },
    { key: 'burstPauseSec', label: 'Pause between bursts (s)', min: 0.1, max: 5, step: 0.1 },
    { key: 'hitChance', label: 'Hit chance per round (0 to 1)', min: 0, max: 1, step: 0.05 },
    { key: 'damagePerHit', label: 'Damage per hit', min: 0, max: 100, step: 1 },
    { key: 'hitGapSec', label: 'Hit budget: one hit per (s)', min: 0, max: 3, step: 0.05 },
    { key: 'missMinOffsetM', label: 'Miss passes at least (m)', min: 0.05, max: 3, step: 0.05 },
    { key: 'missMaxOffsetM', label: 'Miss passes at most (m)', min: 0.1, max: 5, step: 0.05 },
    { key: 'fallTimeSec', label: 'Fall time (s)', min: 0.05, max: 2, step: 0.05 },
    { key: 'respawnDelaySec', label: 'Time down before getting up (s)', min: 0.5, max: 30, step: 0.5 },
  ],
};

export const coverFolder: Folder<CoverKey> = {
  title: 'Choosing cover',
  sliders: [
    { key: 'preferMinM', label: 'Likes cover at least (m from you)', min: 0, max: 30, step: 0.5 },
    { key: 'preferMaxM', label: 'Likes cover at most (m from you)', min: 1, max: 40, step: 0.5 },
    { key: 'rangePenaltyPerM', label: 'Penalty per m outside that', min: 0, max: 5, step: 0.1 },
    { key: 'walkPenaltyPerM', label: 'Penalty per m of walking', min: 0, max: 5, step: 0.05 },
    { key: 'chestShareOfHeight', label: 'Hidden check: chest at (share of height)', min: 0.2, max: 0.9, step: 0.05 },
  ],
};

export const healthFolder: Folder<HealthKey> = {
  title: 'Health and falls',
  sliders: [
    { key: 'maxHealth', label: 'Max health (from next restart)', min: 10, max: 500, step: 5 },
    { key: 'regenDelaySec', label: 'Regeneration starts after (s)', min: 0.5, max: 15, step: 0.5 },
    { key: 'regenCeiling', label: 'Regeneration stops at', min: 10, max: 100, step: 5 },
    { key: 'regenPerSecEasy', label: 'Regeneration per s: Easy', min: 1, max: 50, step: 1 },
    { key: 'regenPerSecNormal', label: 'Regeneration per s: Normal', min: 1, max: 50, step: 1 },
    { key: 'regenPerSecHard', label: 'Regeneration per s: Hard', min: 1, max: 50, step: 1 },
    { key: 'healAmount', label: 'A heal restores', min: 5, max: 100, step: 5 },
    { key: 'healUseSec', label: 'A heal takes (s)', min: 0.1, max: 5, step: 0.1 },
    { key: 'hazardDamagePerSec', label: 'Hazard pad damage (per s)', min: 1, max: 200, step: 1 },
    { key: 'fallSafeSpeedMps', label: 'Safe landing speed (m/s)', min: 3, max: 30, step: 0.5 },
    { key: 'fallDamagePerMps', label: 'Fall damage per m/s over safe', min: 0, max: 100, step: 1 },
    { key: 'fallSlowBaseSec', label: 'Slow after a hard landing (s)', min: 0, max: 5, step: 0.1 },
    { key: 'fallSlowPerMpsSec', label: 'Extra slow per m/s over safe (s)', min: 0, max: 2, step: 0.05 },
    { key: 'fallSlowMaxSec', label: 'Slow lasts at most (s)', min: 0.5, max: 10, step: 0.5 },
    { key: 'fallSlowSpeedShare', label: 'Walking speed while slowed (share)', min: 0.1, max: 1, step: 0.05 },
  ],
};

export const healthFxFolders: Folder<HealthFxKey>[] = [
  {
    title: 'Vignette and colour drain',
    sliders: [
      { key: 'vignetteStartHealth', label: 'Vignette starts at health', min: 10, max: 100, step: 5 },
      { key: 'vignetteFullHealth', label: 'Vignette strongest at health', min: 1, max: 50, step: 1 },
      { key: 'vignetteStartStrength', label: 'Vignette at its start (0 to 1)', min: 0, max: 1, step: 0.05 },
      { key: 'vignetteMaxStrength', label: 'Vignette strongest (0 to 1)', min: 0, max: 1, step: 0.05 },
      { key: 'drainStartHealth', label: 'Colour drain starts at health', min: 5, max: 100, step: 5 },
      { key: 'drainFullHealth', label: 'Colour drain strongest at health', min: 1, max: 50, step: 1 },
      { key: 'drainMax', label: 'Most colour drained (0 to 1)', min: 0, max: 1, step: 0.05 },
      { key: 'easeSec', label: 'Effects ease over (s)', min: 0.05, max: 3, step: 0.05 },
      { key: 'pulseDepth', label: 'Swell on each heartbeat', min: 0, max: 1, step: 0.05 },
      { key: 'pulseSec', label: 'Swell fades over (s)', min: 0.1, max: 1, step: 0.05 },
      { key: 'flashPerDamage', label: 'Hit flash per damage point', min: 0, max: 0.05, step: 0.001 },
      { key: 'flashMax', label: 'Hit flash at most', min: 0, max: 1, step: 0.05 },
      { key: 'flashSec', label: 'Hit flash fades over (s)', min: 0.05, max: 2, step: 0.05 },
    ],
  },
  {
    title: 'Heartbeat and breathing',
    sliders: [
      { key: 'heartbeatBelowHealth', label: 'Heartbeat below health', min: 5, max: 100, step: 5 },
      { key: 'heartbeatFastHealth', label: 'Heartbeat fastest at health', min: 1, max: 50, step: 1 },
      { key: 'heartbeatSlowPerMin', label: 'Slowest heartbeat (per min)', min: 30, max: 200, step: 5 },
      { key: 'heartbeatFastPerMin', label: 'Fastest heartbeat (per min)', min: 30, max: 240, step: 5 },
      { key: 'heartbeatVolume', label: 'Heartbeat volume', min: 0, max: 1.5, step: 0.05 },
      { key: 'breathBelowHealth', label: 'Breathing below health', min: 5, max: 100, step: 5 },
      { key: 'breathFastHealth', label: 'Breathing quickest at health', min: 1, max: 50, step: 1 },
      { key: 'breathSlowEverySec', label: 'Slowest breath (s apart)', min: 1, max: 10, step: 0.5 },
      { key: 'breathFastEverySec', label: 'Quickest breath (s apart)', min: 0.5, max: 5, step: 0.1 },
      { key: 'breathQuietVolume', label: 'Quietest breath volume', min: 0, max: 1.5, step: 0.05 },
      { key: 'breathLoudVolume', label: 'Loudest breath volume', min: 0, max: 1.5, step: 0.05 },
    ],
  },
  {
    title: 'HUD pop-ups',
    sliders: [
      { key: 'hudShowSec', label: 'A pop-up stays (s)', min: 0.5, max: 10, step: 0.5 },
      { key: 'hudFadeSec', label: 'Then fades over (s)', min: 0.1, max: 2, step: 0.1 },
      { key: 'magazinePictureShowSec', label: 'Magazine pictures stay (s)', min: 1, max: 10, step: 0.5 },
    ],
  },
];

/** Health values read when the game starts or restarts, so not on the panel. */
export const healthKeysNotOnPanel: readonly HealthKey[] = ['healCarryLimit', 'startingHeals'];

/** Dummy config values that are not on the panel: the shape is built once when the game starts. */
export const dummyKeysNotOnPanel: readonly DummyKey[] = ['heightM', 'bodyWidthM', 'bodyDepthM', 'headRadiusM'];

/** Stand-in values that are not on the panel: its shape, gun position and collision, built or read as they are. */
export const standInKeysNotOnPanel: readonly StandInKey[] = [
  'eyeHeightM',
  'muzzleHeightM',
  'muzzleForwardM',
  'capsuleRadiusM',
  'aimHeightShareOfEyes',
  'crouchHeightM',
  'crouchEyeHeightM',
  'crouchMuzzleHeightM',
];

/** Rifle config values that are deliberately not on the panel: they are read once when the game starts. */
export const rifleKeysNotOnPanel: readonly RifleKey[] = ['magazineRounds', 'startingMagazines'];

/** Player config values that are deliberately not on the panel, and why. A test makes sure nothing else is missing. */
export const playerKeysNotOnPanel: readonly PlayerKey[] = [
  'capsuleRadiusM', // tied to collision and the camera clearances; change it in the file
  'collisionIterations', // a quality setting, not a feel setting
  'startXM', // spawn
  'startZM',
  'startYawRad',
];

/** The values in `current` that differ from `defaults`. */
export function changedValues(current: Record<string, number>, defaults: Record<string, number>): Record<string, number> {
  const changed: Record<string, number> = {};
  for (const key of Object.keys(defaults)) {
    if (current[key] !== defaults[key]) changed[key] = current[key];
  }
  return changed;
}

/** Puts every value in `current` back to its default. */
export function resetToDefaults(current: Record<string, number>, defaults: Record<string, number>): void {
  for (const key of Object.keys(defaults)) current[key] = defaults[key];
}

/** Text to paste into the config files: only the changed values, in the files' own format. */
export function toCodeSnippet(player: Record<string, number>, input: Record<string, number>, rifle: Record<string, number> = {},
  dummy: Record<string, number> = {},
  more: Record<string, Record<string, number>> = {},
): string {
  const lines: string[] = [];
  const add = (file: string, values: Record<string, number>): void => {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    lines.push(`// ${file}: change these in the defaults object`);
    for (const key of keys) lines.push(`${key}: ${Number(values[key].toPrecision(6))},`);
  };
  add('src/config/player.ts', player);
  add('src/config/input.ts', input);
  add('src/config/rifle.ts', rifle);
  add('src/config/dummy.ts', dummy);
  for (const [file, values] of Object.entries(more)) add(file, values);
  return lines.length > 0 ? lines.join('\n') : '// Nothing changed from the defaults.';
}
