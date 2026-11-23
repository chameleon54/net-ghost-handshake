import { normalYawDeg, rayBoxM, rayTurnedBoxM } from './boxShape';
import { unusedId, type LevelBox, type LevelData, type LevelSpot } from './levelData';

export { rayBoxM };

// The level edit operations (milestone 5.2, decision 273): picking a piece with a ray, moving, turning, duplicating,
// deleting and adding, and undo. Each takes a level and returns a new one (the old one is left as it was, which is what
// undo keeps). Plain functions, no drawing, so they can be tested; src/debug/editMode.ts drives them in game.
// Since 5.2b (decision 281) a selection is the item's id, so it never points at the wrong thing after a delete or undo.
// Since 5.2c (decision 285) a selection is a list of ids, and the `...Many` functions edit all of them as one change.

/** What is selected: the id of a box, a dummy, an enemy spawn, or Rook's start. */
export type Pick = string;

/** Which list an item is in. */
export type ItemList = 'boxes' | 'dummies' | 'spawns' | 'start';

/** A marker (start, dummy, spawn) is picked as an upright box this wide and tall around its spot. */
export const markerWidthM = 0.6;
export const markerHeightM = 1.8;

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function markerBounds(spot: LevelSpot): [Vec3, Vec3] {
  const half = markerWidthM / 2;
  return [
    { x: spot.xM - half, y: 0, z: spot.zM - half },
    { x: spot.xM + half, y: markerHeightM, z: spot.zM + half },
  ];
}

/** The nearest piece or marker the ray hits (its id), or null. Markers are checked too, so one standing by a wall can be picked. */
export function pickAt(level: LevelData, origin: Vec3, dir: Vec3): Pick | null {
  let best: Pick | null = null;
  let bestM = Infinity;
  const consider = (id: string, m: number) => {
    if (m < bestM) {
      best = id;
      bestM = m;
    }
  };
  for (const box of level.boxes) consider(box.id, rayTurnedBoxM(origin, dir, box)); // a turned box is hit where it is drawn (5.5a)
  const marker = (spot: LevelSpot) => {
    const [min, max] = markerBounds(spot);
    return rayBoxM(origin, dir, min, max);
  };
  for (const spot of level.dummies) consider(spot.id, marker(spot));
  for (const spot of level.spawns) consider(spot.id, marker(spot));
  consider(level.start.id, marker(level.start));
  return best;
}

/** Where the item with this id is, or undefined if no item has it (deleted, or undone away). */
export function locate(level: LevelData, id: Pick): { list: ItemList; index: number } | undefined {
  if (level.start.id === id) return { list: 'start', index: 0 };
  for (const list of ['boxes', 'dummies', 'spawns'] as const) {
    const index = (level[list] as readonly { id: string }[]).findIndex((item) => item.id === id);
    if (index >= 0) return { list, index };
  }
  return undefined;
}

/** The selected item, or undefined if no item has this id any more. */
export function picked(level: LevelData, id: Pick): LevelBox | LevelSpot | undefined {
  const at = locate(level, id);
  if (!at) return undefined;
  return at.list === 'start' ? level.start : level[at.list][at.index];
}

/** A copy of the level with the item replaced by `change(item)`; the level itself if no item has this id. */
function withItem(level: LevelData, id: Pick, change: (item: LevelBox & LevelSpot) => object): LevelData {
  const at = locate(level, id);
  if (!at) return level;
  if (at.list === 'start') return { ...level, start: change(level.start as LevelBox & LevelSpot) as LevelSpot };
  const list = level[at.list].slice() as object[];
  list[at.index] = change(list[at.index] as LevelBox & LevelSpot);
  return { ...level, [at.list]: list };
}

/** Moves the item by (dx, dy, dz) metres. Markers stay on the floor; a box never goes below it (0 leaves `yM` out). */
export function moveBy(level: LevelData, id: Pick, dx: number, dy: number, dz: number): LevelData {
  const isBox = locate(level, id)?.list === 'boxes';
  return withItem(level, id, (item) => {
    const moved: LevelBox & LevelSpot = { ...item, xM: item.xM + dx, zM: item.zM + dz };
    if (!isBox) return moved;
    const yM = Math.max((item.yM ?? 0) + dy, 0);
    if (yM > 0) moved.yM = yM;
    else delete moved.yM;
    return moved;
  });
}

/**
 * Turns the item 90 degrees left. A box square to the walls swaps its width and depth (so the file stays without a turn); a
 * turned box (5.5a) and a marker add 90 degrees to their yaw.
 */
export function turn(level: LevelData, id: Pick): LevelData {
  const isBox = locate(level, id)?.list === 'boxes';
  return withItem(level, id, (item) => (isBox && !item.yawDeg ? { ...item, widthM: item.depthM, depthM: item.widthM } : withYaw(item, (item.yawDeg ?? 0) + 90, isBox)));
}

/** The item with its yaw set to `deg` (brought into 0 to 360); a box at 0 leaves the field out, a marker always has it. */
function withYaw<T extends { yawDeg?: number }>(item: T, deg: number, isBox: boolean): T {
  const yawDeg = normalYawDeg(deg);
  const next = { ...item, yawDeg };
  if (isBox && yawDeg === 0) delete (next as { yawDeg?: number }).yawDeg;
  return next;
}

/** Turns every selected item `deg` degrees left (negative: right), each about its own centre (the rotate ring, 5.5a). */
export function turnByMany(level: LevelData, ids: readonly Pick[], deg: number): LevelData {
  return ids.reduce((next, id) => {
    const isBox = locate(next, id)?.list === 'boxes';
    return withItem(next, id, (item) => withYaw(item, (item.yawDeg ?? 0) + deg, isBox));
  }, level);
}

/** Every id in the level, boxes and markers. */
function allIds(level: LevelData): Set<string> {
  return new Set([...level.boxes.map((b) => b.id), level.start.id, ...level.dummies.map((d) => d.id), ...level.spawns.map((s) => s.id)]);
}

/** An id no item uses yet, made from `base`. */
export function freeId(level: LevelData, base: string): string {
  return unusedId(allIds(level), base);
}

/** A copy of the item, 1 m east of it, with a new id; the copy is picked. Rook's start cannot be copied (there is one). */
export function duplicate(level: LevelData, id: Pick): { level: LevelData; pick: Pick } | null {
  const at = locate(level, id);
  if (!at || at.list === 'start') return null;
  const item = level[at.list][at.index];
  const copy = { ...item, xM: item.xM + 1, id: freeId(level, item.id) };
  return { level: { ...level, [at.list]: [...level[at.list], copy] }, pick: copy.id };
}

/** The level without the item. Rook's start cannot be removed. */
export function remove(level: LevelData, id: Pick): LevelData | null {
  const at = locate(level, id);
  if (!at || at.list === 'start') return null;
  return { ...level, [at.list]: (level[at.list] as { id: string }[]).filter((item) => item.id !== id) };
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
  return { level: { ...level, boxes: [...level.boxes, box] }, pick: box.id };
}

/** Adds a dummy or an enemy spawn (a trooper) at (x, z), facing south like the arena's; it is picked. */
export function addMarker(level: LevelData, list: 'dummies' | 'spawns', xM: number, zM: number): { level: LevelData; pick: Pick } {
  const spot: LevelSpot = { id: freeId(level, list === 'dummies' ? 'dummy-1' : 'spawn-1'), xM, zM, yawDeg: 180 };
  if (list === 'dummies') return { level: { ...level, dummies: [...level.dummies, spot] }, pick: spot.id };
  return { level: { ...level, spawns: [...level.spawns, { ...spot, role: 'trooper' as const }] }, pick: spot.id };
}

/** Sets one field of the item (from the panel). `undefined` takes an optional field out. */
export function setField(level: LevelData, id: Pick, field: string, value: unknown): LevelData {
  return withItem(level, id, (item) => {
    const next: Record<string, unknown> = { ...item };
    if (value === undefined) delete next[field];
    else next[field] = value;
    return next;
  });
}

// ---- Many pieces at once (5.2c, decision 285). Each applies the single-item operation to every id in turn, so the editor
// pushes the level once and the whole thing is one undo step. An id that is gone is skipped.

/** Moves every selected item by (dx, dy, dz). */
export function moveMany(level: LevelData, ids: readonly Pick[], dx: number, dy: number, dz: number): LevelData {
  return ids.reduce((next, id) => moveBy(next, id, dx, dy, dz), level);
}

/** Turns every selected item 90 degrees, each around its own centre. */
export function turnMany(level: LevelData, ids: readonly Pick[]): LevelData {
  return ids.reduce((next, id) => turn(next, id), level);
}

/** Sets one field of every selected item. `undefined` takes an optional field out. */
export function setFieldMany(level: LevelData, ids: readonly Pick[], field: string, value: unknown): LevelData {
  return ids.reduce((next, id) => setField(next, id, field, value), level);
}

/** The level without the selected items (Rook's start is left alone); null if there was nothing to remove. */
export function removeMany(level: LevelData, ids: readonly Pick[]): LevelData | null {
  let next = level;
  for (const id of ids) next = remove(next, id) ?? next;
  return next === level ? null : next;
}

/** A copy of each selected item (not Rook's start), 1 m east; the copies are the new selection. Null if nothing could be copied. */
export function duplicateMany(level: LevelData, ids: readonly Pick[]): { level: LevelData; picks: Pick[] } | null {
  let next = level;
  const picks: Pick[] = [];
  for (const id of ids) {
    const copy = duplicate(next, id);
    if (!copy) continue;
    next = copy.level;
    picks.push(copy.pick);
  }
  return picks.length > 0 ? { level: next, picks } : null;
}

/** One line of the editor's list: an item's id and what to call it. */
export interface ListEntry {
  id: Pick;
  label: string;
}

/** A folder of the editor's list: the boxes that share a `group`, or the two folders for the rest. */
export interface ListGroup {
  name: string;
  entries: ListEntry[];
}

export const noGroupName = '(no group)';
export const markersGroupName = '(markers)';
export const noModelGroupName = '(no model yet)';

/** A piece of equipment the player sees: a drawn prop that is not glass (5.5b: these are the boxes that should get a model). */
const isVisibleProp = (box: LevelData['boxes'][number]) => box.kind === 'prop' && box.drawn !== false && !box.glass;

/** How many pieces of equipment have a model, out of all of them (the editor's readout, the asset tracker). */
export function modelCount(level: LevelData): { withModel: number; total: number } {
  const props = level.boxes.filter(isVisibleProp);
  return { withModel: props.filter((box) => box.model !== undefined).length, total: props.length };
}

/** The editor's "(no model yet)" folder: the pieces of equipment still drawn as grey boxes that match `search`; null if none. */
export function noModelGroup(level: LevelData, search: string): ListGroup | null {
  const needle = search.trim().toLowerCase();
  const entries = level.boxes
    .filter((box) => isVisibleProp(box) && box.model === undefined)
    .filter((box) => needle === '' || [box.label, box.id, box.group].some((text) => text?.toLowerCase().includes(needle)))
    .map((box) => ({ id: box.id, label: box.label }));
  return entries.length > 0 ? { name: noModelGroupName, entries } : null;
}

/**
 * What the editor's list shows: every box and marker whose label, id or group contains `search` (any case), in folders:
 * the named groups in alphabetical order, then the boxes with no group, then the markers. An empty folder is left out.
 */
export function listGroups(level: LevelData, search: string): ListGroup[] {
  const needle = search.trim().toLowerCase();
  const matches = (...texts: (string | undefined)[]) => needle === '' || texts.some((text) => text?.toLowerCase().includes(needle));
  const named = new Map<string, ListEntry[]>();
  const loose: ListEntry[] = [];
  for (const box of level.boxes) {
    if (!matches(box.label, box.id, box.group)) continue;
    const entry = { id: box.id, label: box.label };
    if (box.group) named.set(box.group, [...(named.get(box.group) ?? []), entry]);
    else loose.push(entry);
  }
  const markers: ListEntry[] = [];
  const marker = (id: string, label: string) => {
    if (matches(label, id)) markers.push({ id, label });
  };
  marker(level.start.id, "Rook's start");
  level.dummies.forEach((spot) => marker(spot.id, 'dummy'));
  level.spawns.forEach((spot) => marker(spot.id, `enemy spawn (${spot.role})`));
  const groups: ListGroup[] = [...named.keys()].sort().map((name) => ({ name, entries: named.get(name)! }));
  if (loose.length > 0) groups.push({ name: noGroupName, entries: loose });
  if (markers.length > 0) groups.push({ name: markersGroupName, entries: markers });
  return groups;
}

/** Rounds to a step (0.05 m while dragging, the 0.25 m grid with Shift); tidies the float's tail. */
export function snapTo(m: number, stepM: number): number {
  return Math.round(Math.round(m / stepM) * stepM * 1000) / 1000;
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
