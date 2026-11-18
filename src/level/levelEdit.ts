import type { LevelBox, LevelData, LevelSpot } from './levelData';

// The level edit operations (milestone 5.2, decision 273): picking a piece with a ray, moving, turning, duplicating,
// deleting and adding, and undo. Each takes a level and returns a new one (the old one is left as it was, which is what
// undo keeps). Plain functions, no drawing, so they can be tested; src/debug/editMode.ts drives them in game.

/** What is selected: a box, a dummy, an enemy spawn, or Rook's start. */
export type Pick = { list: 'boxes' | 'dummies' | 'spawns'; index: number } | { list: 'start'; index: 0 };

/** A marker (start, dummy, spawn) is picked as an upright box this wide and tall around its spot. */
export const markerWidthM = 0.6;
export const markerHeightM = 1.8;

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Distance along the ray (unit `dir`) to an axis-aligned box, or Infinity if it misses. The slab method. */
export function rayBoxM(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): number {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis] || o > max[axis]) return Infinity; // parallel to this slab and outside it
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return Infinity;
  }
  if (far < 0) return Infinity; // behind the eye
  return Math.max(near, 0);
}

function boxBounds(box: LevelBox): [Vec3, Vec3] {
  const y = box.yM ?? 0;
  return [
    { x: box.xM - box.widthM / 2, y, z: box.zM - box.depthM / 2 },
    { x: box.xM + box.widthM / 2, y: y + box.heightM, z: box.zM + box.depthM / 2 },
  ];
}

function markerBounds(spot: LevelSpot): [Vec3, Vec3] {
  const half = markerWidthM / 2;
  return [
    { x: spot.xM - half, y: 0, z: spot.zM - half },
    { x: spot.xM + half, y: markerHeightM, z: spot.zM + half },
  ];
}

/** The nearest piece or marker the ray hits, or null. Markers are checked too, so one standing by a wall can be picked. */
export function pickAt(level: LevelData, origin: Vec3, dir: Vec3): Pick | null {
  let best: Pick | null = null;
  let bestM = Infinity;
  const consider = (pick: Pick, [min, max]: [Vec3, Vec3]) => {
    const m = rayBoxM(origin, dir, min, max);
    if (m < bestM) {
      best = pick;
      bestM = m;
    }
  };
  level.boxes.forEach((box, index) => consider({ list: 'boxes', index }, boxBounds(box)));
  level.dummies.forEach((spot, index) => consider({ list: 'dummies', index }, markerBounds(spot)));
  level.spawns.forEach((spot, index) => consider({ list: 'spawns', index }, markerBounds(spot)));
  consider({ list: 'start', index: 0 }, markerBounds(level.start));
  return best;
}

/** The selected item, or undefined if the pick no longer points at anything. */
export function picked(level: LevelData, pick: Pick): LevelBox | LevelSpot | undefined {
  return pick.list === 'start' ? level.start : level[pick.list][pick.index];
}

/** A copy of the level with the picked item replaced by `change(item)`. */
function withItem(level: LevelData, pick: Pick, change: (item: LevelBox & LevelSpot) => object): LevelData {
  if (pick.list === 'start') return { ...level, start: change(level.start as LevelBox & LevelSpot) as LevelSpot };
  const list = level[pick.list].slice() as object[];
  list[pick.index] = change(list[pick.index] as LevelBox & LevelSpot);
  return { ...level, [pick.list]: list };
}

/** Moves the picked item by (dx, dy, dz) metres. Markers stay on the floor; a box never goes below it (0 leaves `yM` out). */
export function moveBy(level: LevelData, pick: Pick, dx: number, dy: number, dz: number): LevelData {
  return withItem(level, pick, (item) => {
    const moved: LevelBox & LevelSpot = { ...item, xM: item.xM + dx, zM: item.zM + dz };
    if (pick.list !== 'boxes') return moved;
    const yM = Math.max((item.yM ?? 0) + dy, 0);
    if (yM > 0) moved.yM = yM;
    else delete moved.yM;
    return moved;
  });
}

/** Turns the picked item 90 degrees: a box swaps its width and depth (boxes stay square to the walls); a marker turns left. */
export function turn(level: LevelData, pick: Pick): LevelData {
  return withItem(level, pick, (item) =>
    pick.list === 'boxes' ? { ...item, widthM: item.depthM, depthM: item.widthM } : { ...item, yawDeg: (((item.yawDeg + 90) % 360) + 360) % 360 },
  );
}

/** An id not yet used by any box, made from `base`. */
export function freeId(level: LevelData, base: string): string {
  const ids = new Set(level.boxes.map((box) => box.id));
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** A copy of the picked box or marker, 1 m east of it; the copy is picked. Rook's start cannot be copied (there is one). */
export function duplicate(level: LevelData, pick: Pick): { level: LevelData; pick: Pick } | null {
  if (pick.list === 'start') return null;
  const item = picked(level, pick);
  if (!item) return null;
  const copy = { ...item, xM: item.xM + 1 } as LevelBox & LevelSpot;
  if (pick.list === 'boxes') copy.id = freeId(level, (item as LevelBox).id);
  const list = [...level[pick.list], copy] as object[];
  return { level: { ...level, [pick.list]: list }, pick: { list: pick.list, index: list.length - 1 } };
}

/** The level without the picked item. Rook's start cannot be removed. */
export function remove(level: LevelData, pick: Pick): LevelData | null {
  if (pick.list === 'start') return null;
  return { ...level, [pick.list]: (level[pick.list] as object[]).filter((_, i) => i !== pick.index) };
}

/** What a new piece from the panel starts as (bands as in level.md); its centre goes where you look. */
export const boxPresets = {
  'low cover': { kind: 'prop', widthM: 1.2, depthM: 1.2, heightM: 1 },
  climbable: { kind: 'prop', widthM: 1.5, depthM: 1.5, heightM: 1.5 },
  'high cover': { kind: 'prop', widthM: 1, depthM: 1, heightM: 2.4 },
  wall: { kind: 'wall', widthM: 4, depthM: 0.3, heightM: 3 },
  glass: { kind: 'prop', widthM: 2, depthM: 0.1, heightM: 2.4, glass: true },
} as const satisfies Record<string, Partial<LevelBox>>;
export type BoxPreset = keyof typeof boxPresets;

/** Adds a new box from a preset with its centre at (x, z); it is picked. */
export function addBox(level: LevelData, preset: BoxPreset, xM: number, zM: number): { level: LevelData; pick: Pick } {
  const box: LevelBox = { id: freeId(level, preset.replace(/ /g, '-')), label: preset, xM, zM, ...boxPresets[preset] };
  const boxes = [...level.boxes, box];
  return { level: { ...level, boxes }, pick: { list: 'boxes', index: boxes.length - 1 } };
}

/** Adds a dummy or an enemy spawn (a trooper) at (x, z), facing south like the arena's; it is picked. */
export function addMarker(level: LevelData, list: 'dummies' | 'spawns', xM: number, zM: number): { level: LevelData; pick: Pick } {
  const spot: LevelSpot = { xM, zM, yawDeg: 180 };
  if (list === 'dummies') {
    const dummies = [...level.dummies, spot];
    return { level: { ...level, dummies }, pick: { list, index: dummies.length - 1 } };
  }
  const spawns = [...level.spawns, { ...spot, role: 'trooper' as const }];
  return { level: { ...level, spawns }, pick: { list, index: spawns.length - 1 } };
}

/** Sets one field of the picked item (from the panel). `undefined` takes an optional field out. */
export function setField(level: LevelData, pick: Pick, field: string, value: unknown): LevelData {
  return withItem(level, pick, (item) => {
    const next: Record<string, unknown> = { ...item };
    if (value === undefined) delete next[field];
    else next[field] = value;
    return next;
  });
}

/** The levels before each change, newest last, for undo; at most `limit` kept. */
export class EditHistory {
  private readonly steps: LevelData[] = [];

  constructor(private readonly limit = 50) {}

  /** Call with the level as it was, just before changing it. */
  push(before: LevelData): void {
    this.steps.push(before);
    if (this.steps.length > this.limit) this.steps.shift();
  }

  /** The level before the last change, or null if there is nothing to undo. */
  undo(): LevelData | null {
    return this.steps.pop() ?? null;
  }

  get size(): number {
    return this.steps.length;
  }
}
