import type { InputConfig } from '../config/input';
import type { PlayerConfig } from '../config/player';

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
export function toCodeSnippet(player: Record<string, number>, input: Record<string, number>): string {
  const lines: string[] = [];
  const add = (file: string, values: Record<string, number>): void => {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    lines.push(`// ${file}: change these in the defaults object`);
    for (const key of keys) lines.push(`${key}: ${Number(values[key].toPrecision(6))},`);
  };
  add('src/config/player.ts', player);
  add('src/config/input.ts', input);
  return lines.length > 0 ? lines.join('\n') : '// Nothing changed from the defaults.';
}
