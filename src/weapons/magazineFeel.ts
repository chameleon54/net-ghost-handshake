import type { Magazines } from './magazines';

export type MagazineFeel = 'full' | 'mostlyFull' | 'aboutHalf' | 'nearlyEmpty' | 'empty';

/** How full one magazine looks: a rough word for text, and the exact share (0 to 1) for a picture to draw later. */
export interface MagazineReading {
  feel: MagazineFeel;
  /** Rounds as a share of a full magazine, 0 to 1. A picture should round this to a few steps so it stays a rough look. */
  share: number;
}

/** What checking shows: the magazine in the gun, then the spares in the order a reload will use them (fullest first). */
export interface MagazineCheck {
  gun: MagazineReading;
  spares: MagazineReading[];
}

// Where the rough words start, as a share of a full magazine. Starting values (weapons.md: judged by feel, not by number).
const mostlyFullAbove = 0.6;
const aboutHalfAbove = 0.3;

/** What the player judges from looking at a magazine holding `rounds` of `capacity`: a rough word, never a count. */
export function readMagazine(rounds: number, capacity: number): MagazineReading {
  const share = Math.min(Math.max(rounds / capacity, 0), 1);
  if (rounds <= 0) return { feel: 'empty', share: 0 };
  if (rounds >= capacity) return { feel: 'full', share: 1 };
  if (share > mostlyFullAbove) return { feel: 'mostlyFull', share };
  if (share > aboutHalfAbove) return { feel: 'aboutHalf', share };
  return { feel: 'nearlyEmpty', share };
}

/** The gun's own magazine (with the chambered round counted), judged by feel. */
export function magazineFeel(magazines: Magazines): MagazineFeel {
  return readMagazine(magazines.loadedRounds, magazines.capacityRounds).feel;
}

/** Everything the check shows: the gun's magazine and each spare. */
export function checkMagazines(magazines: Magazines): MagazineCheck {
  return {
    gun: readMagazine(magazines.loadedRounds, magazines.capacityRounds),
    spares: magazines.spareRounds().map((rounds) => readMagazine(rounds, magazines.capacityRounds)),
  };
}
