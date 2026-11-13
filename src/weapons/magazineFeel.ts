import type { Magazines } from './magazines';

export type MagazineFeel = 'full' | 'mostlyFull' | 'aboutHalf' | 'nearlyEmpty' | 'empty';

// Where the rough words start, as a share of a full magazine. Starting values (weapons.md: judged by feel, not by number).
const mostlyFullAbove = 0.6;
const aboutHalfAbove = 0.3;

/** What the player judges from looking at the magazine: a rough word, never a count. */
export function magazineFeel(magazines: Magazines): MagazineFeel {
  const share = magazines.loadedRounds / magazines.capacityRounds;
  if (magazines.loadedRounds === 0) return 'empty';
  if (share >= 1) return 'full';
  if (share > mostlyFullAbove) return 'mostlyFull';
  if (share > aboutHalfAbove) return 'aboutHalf';
  return 'nearlyEmpty';
}
