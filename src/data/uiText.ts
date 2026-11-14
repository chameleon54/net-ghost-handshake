// Player-facing text lives in data, by key, so it can be translated later (see tech-stack.md).
// Placeholder wording; the real menus come in milestone 7.3.
export const uiText = {
  clickToPlay: 'Click to play',
  paused: 'Paused. Click to resume',
  /** Names shown briefly when a weapon is taken out. Real names: P9 and M4-A, never the real-world gun names (weapons.md). */
  weaponNames: { rifle: 'M4-A', pistol: 'P9', knife: 'Knife' },
  /** The jam prompt (ui.md: "Tap R"). */
  jammed: 'JAMMED   Tap R',
  /** Label for the grenade count, shown briefly (ui.md). */
  grenades: 'Grenades',
  /** Label for the heal count, and the word shown while one is being used. */
  heals: 'Heals',
  healing: 'HEALING',
  /** Temporary death text (the real death screen is milestone 7.3). */
  died: 'You died. Press Enter to restart',
  captureRefused: 'The browser did not allow that yet. Click again',
  /** Shown under "Click to play" if the enemies' navigation failed to load (decision 219). */
  navigationFailed: 'Enemy navigation could not load, so enemies will stand still. Reload the page to try again',
} as const;
