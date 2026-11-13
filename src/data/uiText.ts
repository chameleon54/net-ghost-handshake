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
  captureRefused: 'The browser did not allow that yet. Click again',
} as const;
