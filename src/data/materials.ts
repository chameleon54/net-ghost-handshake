// The lab's materials (5.5c Part 1, decision 290). Each is drawn by the game itself on a small canvas (src/level/materials.ts),
// so there are no texture files. A material repeats at real size: one picture covers `tileM` metres (width, height) of a
// face, so a long wall gets more tiles, not stretched ones. To add a material, add one entry here with a pattern and its
// colours; the editor's Materials tab and the level checker pick it up.
//
// The palette (assets.md, "for now"): cool greys and off-whites for the lab, one warning colour, one accent for screens.

export const palette = {
  labWhite: '#c9ced3',
  labSeam: '#9aa1a8',
  tile: '#80878e',
  grout: '#61686f',
  metal: '#4c535a',
  metalLine: '#3a4046',
  darkMetal: '#2f3439',
  concrete: '#6b6e71',
  concreteSpeck: '#5d6063',
  warning: '#d9a321',
  warningDark: '#1d1f21',
  accent: '#39c6e6',
  accentDim: '#0f3a45',
  light: '#7dffb0',
} as const;

/** How a material's picture is drawn (src/level/materials.ts paints each). */
export type Pattern = 'panels' | 'tiles' | 'plates' | 'plain' | 'stripes' | 'screen' | 'rack' | 'lockers' | 'fridge' | 'hood';

export interface MaterialDef {
  name: string;
  /** What the editor shows. */
  label: string;
  pattern: Pattern;
  /** How much of a face one picture covers, metres across and up. */
  tileM: readonly [number, number];
  /** The main colour, and the colour of its lines (seams, grout, slots). */
  base: string;
  line: string;
  /**
   * A front for a piece of equipment: this picture goes on the box's front face only (the side its turn faces, -z when
   * not turned) and `rest` on the other faces, so a plain box reads as a rack or a row of lockers.
   */
  front?: { rest: string };
  /** Glows in the dark (screens). */
  glow?: boolean;
}

export const materialDefs: readonly MaterialDef[] = [
  { name: 'lab-wall', label: 'lab wall panels', pattern: 'panels', tileM: [1.2, 1.2], base: palette.labWhite, line: palette.labSeam },
  { name: 'floor-tiles', label: 'floor tiles', pattern: 'tiles', tileM: [0.6, 0.6], base: palette.tile, line: palette.grout },
  { name: 'metal-floor', label: 'metal floor plates', pattern: 'plates', tileM: [1.2, 1.2], base: palette.metal, line: palette.metalLine },
  { name: 'metal-panel', label: 'metal panel', pattern: 'panels', tileM: [1, 1], base: palette.metal, line: palette.metalLine },
  { name: 'concrete', label: 'concrete', pattern: 'plain', tileM: [2, 2], base: palette.concrete, line: palette.concreteSpeck },
  { name: 'hazard', label: 'hazard stripes', pattern: 'stripes', tileM: [0.8, 0.8], base: palette.warning, line: palette.warningDark },
  { name: 'screen', label: 'screen', pattern: 'screen', tileM: [0.6, 0.4], base: palette.accentDim, line: palette.accent, glow: true },
  { name: 'rack-front', label: 'server rack front', pattern: 'rack', tileM: [0.6, 2], base: palette.darkMetal, line: palette.metalLine, front: { rest: 'metal-panel' } },
  { name: 'lockers-front', label: 'lockers front', pattern: 'lockers', tileM: [0.5, 1.9], base: palette.metal, line: palette.metalLine, front: { rest: 'metal-panel' } },
  { name: 'fridge-front', label: 'fridge front', pattern: 'fridge', tileM: [0.8, 1.9], base: palette.labWhite, line: palette.labSeam, front: { rest: 'lab-wall' } },
  { name: 'hood-front', label: 'fume hood front', pattern: 'hood', tileM: [1.5, 2.2], base: palette.labWhite, line: palette.labSeam, front: { rest: 'lab-wall' } },
];

export const materialNames: readonly string[] = materialDefs.map((def) => def.name);
export const materialDef = (name: string): MaterialDef | undefined => materialDefs.find((def) => def.name === name);

/** The material a box gets when it names none: walls are lab wall panels, everything else metal panels. */
export const defaultMaterial = (kind: 'wall' | 'prop' | 'marker'): string => (kind === 'wall' ? 'lab-wall' : 'metal-panel');

/** The floor: the bare floor is tiles; a patch with its own footstep surface gets the matching look. */
export const floorMaterial = { bare: 'floor-tiles', tile: 'floor-tiles', metal: 'metal-floor', concrete: 'concrete' } as const;

/** A first guess from a piece's label, for the grey equipment no model fits (the owner changes it by eye); null: keep the default. */
export function suggestMaterial(label: string): string | null {
  // The first rule that matches wins, so floors and structure come before equipment ("server core floor" is a floor).
  const rules: [RegExp, string][] = [
    [/floor|deck/i, 'metal-floor'],
    [/pillar|catwalk|parapet/i, 'concrete'],
    [/server|power cabinet|rack/i, 'rack-front'],
    [/locker|cupboard|ppe/i, 'lockers-front'],
    [/fridge|chiller|cooling/i, 'fridge-front'],
    [/fume hood/i, 'hood-front'],
    [/console/i, 'screen'],
  ];
  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}
