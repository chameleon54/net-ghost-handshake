import type { InputConfig } from '../config/input';
import type { PlayerConfig } from '../config/player';
import type { DummyConfig } from '../config/dummy';
import type { KnifeConfig } from '../config/knife';
import type { PistolConfig } from '../config/pistol';
import type { RifleConfig } from '../config/rifle';

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
  ],
};

export const rifleFolders: Folder<RifleKey>[] = [
  {
    title: 'Rifle',
    sliders: [
      { key: 'fireRateRpm', label: 'Fire rate (rounds/min)', min: 100, max: 1500, step: 10 },
      { key: 'reloadTimeSec', label: 'Reload time (s)', min: 0.3, max: 5, step: 0.05 },
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

/** Dummy config values that are not on the panel: the shape is built once when the game starts. */
export const dummyKeysNotOnPanel: readonly DummyKey[] = ['heightM', 'bodyWidthM', 'bodyDepthM', 'headRadiusM'];

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
