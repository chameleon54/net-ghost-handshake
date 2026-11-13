// Player-facing text lives in data, by key, so it can be translated later (see tech-stack.md).
// Placeholder wording; the real menus come in milestone 7.3.
export const uiText = {
  clickToPlay: 'Click to play',
  paused: 'Paused. Click to resume',
  /** Temporary names for the readout. Real names: P9 and M4-A, never the real-world gun names (weapons.md). */
  weaponNames: { rifle: 'M4-A', pistol: 'P9', knife: 'Knife' },
  /** Temporary readout words for checking the magazine (weapons.md: a rough word, never a number). */
  magazineFeel: { full: 'full', mostlyFull: 'mostly full', aboutHalf: 'about half', nearlyEmpty: 'nearly empty', empty: 'empty' },
  /** Temporary readout labels for the magazine check. */
  magazineCheck: { gun: 'Magazine', spares: 'Spares', noSpares: 'none' },
  /** The jam prompt (ui.md: "Tap R"). */
  jammed: 'JAMMED   Tap R',
  /** Temporary readout label for the grenade count (ui.md: the real HUD shows it only briefly). */
  grenades: 'Grenades',
  /** Temporary death text (the real death screen is milestone 7.3). */
  died: 'You died. Press Enter to restart',
  captureRefused: 'The browser did not allow that yet. Click again',
} as const;
