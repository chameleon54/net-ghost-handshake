// Target dummy tuning (the test stand-ins from milestone 2.2). Units are in the names.
export const dummyConfigDefaults = {
  /** Same as a trooper (enemies.md). Read when a dummy stands up, so a change applies from its next life. */
  healthPoints: 100,
  /** Time to tip over after dying. */
  fallTimeSec: 0.4,
  /** Time lying down before it stands up again at full health. */
  respawnDelaySec: 3,
  // Shape. Not on the panel: the drawn dummy is built once from these.
  heightM: 1.8,
  bodyWidthM: 0.5,
  bodyDepthM: 0.3,
  headRadiusM: 0.12,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type DummyConfig = { -readonly [K in keyof typeof dummyConfigDefaults]: number };
export const dummyConfig: DummyConfig = { ...dummyConfigDefaults };
