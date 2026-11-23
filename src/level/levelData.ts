import { roles, type Role } from '../config/roles';
import { rampRises, type FloorZone, type HazardPad, type RoomBox, type RoomLayout, type Surface } from '../data/greyboxRoom';
import type { CoverPoint } from './cover';
import { isModelName, modelTurnsDeg } from './modelFit';

// The level data format (milestone 5.2, decision 273; level.md "Level data"). A level is a JSON file in src/data/levels/,
// imported by the game (so it ships inside the build and works offline), checked here on load, and written back by the
// dev server's edit mode. `formatVersion` lets the format grow. Some lists are reserved: typed and checked now, used later
// (glass in 5.4, acoustic zones in 7d, the announcer's speakers, wave arrival areas in 7.1). No drawing here.

/**
 * Version 2 (5.2b, decision 281) gave the start, dummies and spawns an `id`; version 3 (5.2c, decision 285) lets a box carry
 * a `group`; version 4 (5.5a, decision 286) lets a box be turned (`yawDeg`); version 5 (5.5b, decision 287) lets a box be
 * drawn as a model (`model`, `modelYawDeg`). An older file still loads (a version 1 file gets the ids) and is written back
 * as the current version.
 */
export const levelFormatVersion = 5;
/** Every version this game reads. */
const readableVersions = [1, 2, 3, 4, levelFormatVersion];

/** A box in the level: a wall or a piece of equipment. `id` is unique in the level; `label` says what it is ("prep bench A"). */
export interface LevelBox extends RoomBox {
  id: string;
  label: string;
  kind: 'wall' | 'prop';
  /** A folder for the editor's list ("ring", "core"); only the editor uses it (5.2c). Left out: no group. */
  group?: string;
  /**
   * Drawn as this model instead of a grey box (5.5b): `prop-<name>` (a game file) or `kit:<folder>/<file>` (a kit being
   * tried, dev server only). The box stays the collision; the model is fitted inside it (src/level/modelFit.ts).
   */
  model?: string;
  /** The model turned inside its box: 90, 180 or 270 degrees, positive left. Left out: 0. */
  modelYawDeg?: number;
}

/** Where something stands and which way it faces, in degrees (0 = north, -z; 90 = west: positive turns left, as the player's yaw). */
export interface LevelSpot {
  /** Unique in the level, boxes included ("start", "dummy-1", "spawn-3"): the editor selects by it (5.2b). */
  id: string;
  xM: number;
  zM: number;
  yawDeg: number;
}

/** An enemy's spawn, with its role. */
export interface LevelSpawn extends LevelSpot {
  role: Role;
}

/** How a place sounds (7d, decision 255). */
export type AcousticKind = 'open' | 'closed-room' | 'big-hall';
export interface AcousticZone {
  xM: number;
  zM: number;
  widthM: number;
  depthM: number;
  zone: AcousticKind;
}

/** A loudspeaker of the lab announcer (level.md "Lab announcer"). */
export interface Speaker {
  xM: number;
  yM: number;
  zM: number;
}

/** Where a wave's squad gathers out of sight before it comes in (7.1). */
export interface Arrival {
  xM: number;
  zM: number;
  widthM: number;
  depthM: number;
}

/** A generated cover spot to take away: every generated spot within `coverRemoveRadiusM` of here. */
export interface CoverRemoval {
  xM: number;
  zM: number;
}

export interface LevelData {
  formatVersion: number;
  name: string;
  floor: { widthM: number; depthM: number; surfaces: FloorZone[]; hazards: HazardPad[] };
  start: LevelSpot;
  dummies: LevelSpot[];
  spawns: LevelSpawn[];
  boxes: LevelBox[];
  coverAdd: CoverPoint[];
  coverRemove: CoverRemoval[];
  acousticZones: AcousticZone[];
  speakers: Speaker[];
  arrivals: Arrival[];
}

/** A hand removal takes away generated cover spots this close to it. */
export const coverRemoveRadiusM = 0.3;
/** A level name: lowercase letters, digits and hyphens (it is also the file name). */
export const levelNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A level file that does not fit the format: every problem found, one per line. */
export class LevelError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The level data has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.join('\n')}`);
    this.name = 'LevelError';
  }
}

const surfaces: readonly Surface[] = ['concrete', 'metal', 'tile'];
const acousticKinds: readonly AcousticKind[] = ['open', 'closed-room', 'big-hall'];

/** Collects problems while it reads; each reader returns a safe value so the rest can still be checked. */
class Reader {
  readonly problems: string[] = [];

  private fail(path: string, wanted: string): void {
    this.problems.push(`${path} must be ${wanted}`);
  }

  object(value: unknown, path: string): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
    this.fail(path, 'an object');
    return {};
  }

  list(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) return value;
    this.fail(path, 'a list');
    return [];
  }

  number(value: unknown, path: string, check: 'any' | 'positive' | 'not negative' = 'any'): number {
    const ok = typeof value === 'number' && Number.isFinite(value) && (check === 'any' || (check === 'positive' ? value > 0 : value >= 0));
    if (ok) return value;
    this.fail(path, check === 'any' ? 'a number' : check === 'positive' ? 'a number above 0' : 'a number of 0 or more');
    return check === 'positive' ? 1 : 0;
  }

  text(value: unknown, path: string): string {
    if (typeof value === 'string' && value.length > 0) return value;
    this.fail(path, 'a text');
    return '?';
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
    if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T;
    this.fail(path, `one of ${options.join(', ')}`);
    return options[0];
  }

  /** An optional field: left out is fine, anything else must pass `read`. */
  optional<T>(value: unknown, read: () => T): T | undefined {
    return value === undefined ? undefined : read();
  }

  flag(value: unknown, path: string): boolean | undefined {
    if (value === undefined || typeof value === 'boolean') return value;
    this.fail(path, 'true or false');
    return undefined;
  }

  rect(value: unknown, path: string): { xM: number; zM: number; widthM: number; depthM: number } {
    const o = this.object(value, path);
    return {
      xM: this.number(o.xM, `${path}.xM`),
      zM: this.number(o.zM, `${path}.zM`),
      widthM: this.number(o.widthM, `${path}.widthM`, 'positive'),
      depthM: this.number(o.depthM, `${path}.depthM`, 'positive'),
    };
  }

  /** A spot; a missing id comes back as '' and is filled in by the checker once every id is known. */
  spot(value: unknown, path: string): LevelSpot {
    const o = this.object(value, path);
    const id = o.id === undefined ? '' : this.text(o.id, `${path}.id`);
    return { id, xM: this.number(o.xM, `${path}.xM`), zM: this.number(o.zM, `${path}.zM`), yawDeg: this.number(o.yawDeg, `${path}.yawDeg`) };
  }
}

/** Reads one box; leaves optional fields out when they are not in the file, so it writes back the same. */
function readBox(r: Reader, value: unknown, path: string): LevelBox {
  const o = r.object(value, path);
  const box: LevelBox = {
    id: r.text(o.id, `${path}.id`),
    label: r.text(o.label, `${path}.label`),
    kind: r.oneOf(o.kind, `${path}.kind`, ['wall', 'prop'] as const),
    xM: r.number(o.xM, `${path}.xM`),
    zM: r.number(o.zM, `${path}.zM`),
    widthM: r.number(o.widthM, `${path}.widthM`, 'positive'),
    depthM: r.number(o.depthM, `${path}.depthM`, 'positive'),
    heightM: r.number(o.heightM, `${path}.heightM`, 'positive'),
  };
  const yM = r.optional(o.yM, () => r.number(o.yM, `${path}.yM`, 'not negative'));
  const yawDeg = r.optional(o.yawDeg, () => r.number(o.yawDeg, `${path}.yawDeg`));
  const climbable = r.flag(o.climbable, `${path}.climbable`);
  const surface = r.optional(o.surface, () => r.oneOf(o.surface, `${path}.surface`, surfaces));
  const glass = r.flag(o.glass, `${path}.glass`);
  const ramp = r.optional(o.ramp, () => r.oneOf(o.ramp, `${path}.ramp`, rampRises));
  const drawn = r.flag(o.drawn, `${path}.drawn`);
  const solid = r.flag(o.solid, `${path}.solid`);
  const group = r.optional(o.group, () => r.text(o.group, `${path}.group`));
  const model = r.optional(o.model, () => r.text(o.model, `${path}.model`));
  const modelYawDeg = r.optional(o.modelYawDeg, () => r.number(o.modelYawDeg, `${path}.modelYawDeg`));
  if (model !== undefined && !isModelName(model)) r.problems.push(`${path}.model must be "prop-<name>" (a game model) or "kit:<folder>/<file>" (a kit being tried)`);
  if (modelYawDeg !== undefined && !modelTurnsDeg.includes(modelYawDeg)) r.problems.push(`${path}.modelYawDeg must be one of ${modelTurnsDeg.join(', ')}`);
  if (yM !== undefined) box.yM = yM;
  if (yawDeg !== undefined) box.yawDeg = yawDeg;
  if (climbable !== undefined) box.climbable = climbable;
  if (surface !== undefined) box.surface = surface;
  if (glass !== undefined) box.glass = glass;
  if (ramp !== undefined) box.ramp = ramp;
  if (drawn !== undefined) box.drawn = drawn;
  if (solid !== undefined) box.solid = solid;
  if (group !== undefined) box.group = group;
  if (model !== undefined) box.model = model;
  if (modelYawDeg) box.modelYawDeg = modelYawDeg; // 0 is left out
  if (drawn === false && solid === false) r.problems.push(`${path} is neither drawn nor solid, so it does nothing`);
  return box;
}

function readCoverPoint(r: Reader, value: unknown, path: string): CoverPoint {
  const o = r.object(value, path);
  const lean = r.optional(o.lean, () => r.oneOf(o.lean, `${path}.lean`, ['left', 'right', 'both'] as const));
  return {
    xM: r.number(o.xM, `${path}.xM`),
    zM: r.number(o.zM, `${path}.zM`),
    height: r.oneOf(o.height, `${path}.height`, ['low', 'high'] as const),
    facingYawRad: r.number(o.facingYawRad, `${path}.facingYawRad`),
    ...(lean ? { lean } : {}),
  };
}

/**
 * Checks a level read from a file (anything at all) and returns it typed, or throws a `LevelError` naming every problem
 * ("boxes[12].heightM must be a number above 0"). The checker is the one gate: the game, the tests and the dev server's
 * save all go through it.
 */
export function checkLevel(raw: unknown): LevelData {
  const r = new Reader();
  const o = r.object(raw, 'level');
  const version = r.number(o.formatVersion, 'formatVersion');
  if (!readableVersions.includes(version) && r.problems.length === 0) r.problems.push(`formatVersion must be one of ${readableVersions.join(', ')} (this game reads all of them)`);
  const name = r.text(o.name, 'name');
  if (!levelNamePattern.test(name)) r.problems.push('name must be lowercase letters, digits and hyphens (it is also the file name)');
  const floorIn = r.object(o.floor, 'floor');
  const floor = {
    widthM: r.number(floorIn.widthM, 'floor.widthM', 'positive'),
    depthM: r.number(floorIn.depthM, 'floor.depthM', 'positive'),
    surfaces: r.list(floorIn.surfaces, 'floor.surfaces').map((s, i) => {
      const path = `floor.surfaces[${i}]`;
      return { ...r.rect(s, path), surface: r.oneOf(r.object(s, path).surface, `${path}.surface`, surfaces) };
    }),
    hazards: r.list(floorIn.hazards, 'floor.hazards').map((h, i) => r.rect(h, `floor.hazards[${i}]`)),
  };
  const boxes = r.list(o.boxes, 'boxes').map((b, i) => readBox(r, b, `boxes[${i}]`));
  const level: LevelData = {
    formatVersion: levelFormatVersion, // an older file is upgraded as it is read (a version 1 file gains the markers' ids)
    name,
    floor,
    start: r.spot(o.start, 'start'),
    dummies: r.list(o.dummies, 'dummies').map((d, i) => r.spot(d, `dummies[${i}]`)),
    spawns: r.list(o.spawns, 'spawns').map((s, i) => ({ ...r.spot(s, `spawns[${i}]`), role: r.oneOf(r.object(s, `spawns[${i}]`).role, `spawns[${i}].role`, roles) })),
    boxes,
    coverAdd: r.list(o.coverAdd, 'coverAdd').map((c, i) => readCoverPoint(r, c, `coverAdd[${i}]`)),
    coverRemove: r.list(o.coverRemove, 'coverRemove').map((c, i) => {
      const p = r.object(c, `coverRemove[${i}]`);
      return { xM: r.number(p.xM, `coverRemove[${i}].xM`), zM: r.number(p.zM, `coverRemove[${i}].zM`) };
    }),
    acousticZones: r.list(o.acousticZones, 'acousticZones').map((z, i) => ({
      ...r.rect(z, `acousticZones[${i}]`),
      zone: r.oneOf(r.object(z, `acousticZones[${i}]`).zone, `acousticZones[${i}].zone`, acousticKinds),
    })),
    speakers: r.list(o.speakers, 'speakers').map((s, i) => {
      const p = r.object(s, `speakers[${i}]`);
      return { xM: r.number(p.xM, `speakers[${i}].xM`), yM: r.number(p.yM, `speakers[${i}].yM`), zM: r.number(p.zM, `speakers[${i}].zM`) };
    }),
    arrivals: r.list(o.arrivals, 'arrivals').map((a, i) => r.rect(a, `arrivals[${i}]`)),
  };
  checkIds(r, level);
  if (r.problems.length > 0) throw new LevelError(r.problems);
  return level;
}

/**
 * Every id in the level (boxes and markers) must be unique. A marker read without one gets one here: `start`, `dummy-1`,
 * `spawn-1`, ..., skipping any already taken.
 */
function checkIds(r: Reader, level: LevelData): void {
  const named: [string, { id: string }][] = [
    ...level.boxes.map((box, i): [string, { id: string }] => [`boxes[${i}]`, box]),
    ['start', level.start],
    ...level.dummies.map((spot, i): [string, { id: string }] => [`dummies[${i}]`, spot]),
    ...level.spawns.map((spot, i): [string, { id: string }] => [`spawns[${i}]`, spot]),
  ];
  const seen = new Set<string>();
  for (const [path, item] of named) {
    if (item.id === '') continue;
    if (seen.has(item.id)) r.problems.push(`${path}.id "${item.id}" is used twice (ids must be unique)`);
    seen.add(item.id);
  }
  const fill = (item: { id: string }, base: string) => {
    if (item.id !== '') return;
    item.id = unusedId(seen, base);
    seen.add(item.id);
  };
  fill(level.start, 'start');
  level.dummies.forEach((spot) => fill(spot, 'dummy-1'));
  level.spawns.forEach((spot) => fill(spot, 'spawn-1'));
}

/** `base` if it is free, else the same with the next free number (`spawn-1`, `spawn-2`; `bench`, `bench-2`). */
export function unusedId(taken: ReadonlySet<string>, base: string): string {
  if (!taken.has(base)) return base;
  const stem = base.replace(/-\d+$/, '');
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

/** The floor as the grey-box builder and footsteps want it. */
export function levelLayout(level: LevelData): RoomLayout {
  return { size: { widthM: level.floor.widthM, depthM: level.floor.depthM }, floors: level.floor.surfaces, hazards: level.floor.hazards };
}

/** A spot as the game's code wants it: its facing in radians. */
export function spotRad<T extends LevelSpot>(spot: T): Omit<T, 'yawDeg'> & { yawRad: number } {
  const { yawDeg, ...rest } = spot;
  return { ...rest, yawRad: (yawDeg * Math.PI) / 180 };
}

/** Distances (keys ending in M) to the millimetre, so floating-point dust from editing (0.30000000000000004) never reaches the file; angles in degrees to a tenth. */
const tidy = (key: string, value: unknown): unknown => {
  if (typeof value !== 'number') return value;
  if (key.endsWith('M')) return Math.round(value * 1000) / 1000;
  if (key.endsWith('Deg')) return Math.round(value * 10) / 10;
  return value;
};
const mm = (value: number): number => tidy('M', value) as number;

/**
 * The level as the file's text: a fixed key order (the order of `LevelData` and of each item as the checker builds it),
 * 2-space indents, numbers to the millimetre, one item per line in the long lists, so a change shows as a small diff.
 */
export function levelToJson(level: LevelData): string {
  const checked = checkLevel(JSON.parse(JSON.stringify(level))); // the same order and the same optional fields as on load
  const line = (item: object) => JSON.stringify(item, (key, value: unknown) => tidy(key, value));
  const list = (items: readonly object[], indent: string) =>
    items.length === 0 ? '[]' : `[\n${items.map((item) => `${indent}  ${line(item)}`).join(',\n')}\n${indent}]`;
  const { floor } = checked;
  return [
    '{',
    `  "formatVersion": ${checked.formatVersion},`,
    `  "name": ${JSON.stringify(checked.name)},`,
    `  "floor": {`,
    `    "widthM": ${mm(floor.widthM)},`,
    `    "depthM": ${mm(floor.depthM)},`,
    `    "surfaces": ${list(floor.surfaces, '    ')},`,
    `    "hazards": ${list(floor.hazards, '    ')}`,
    `  },`,
    `  "start": ${line(checked.start)},`,
    `  "dummies": ${list(checked.dummies, '  ')},`,
    `  "spawns": ${list(checked.spawns, '  ')},`,
    `  "boxes": ${list(checked.boxes, '  ')},`,
    `  "coverAdd": ${list(checked.coverAdd, '  ')},`,
    `  "coverRemove": ${list(checked.coverRemove, '  ')},`,
    `  "acousticZones": ${list(checked.acousticZones, '  ')},`,
    `  "speakers": ${list(checked.speakers, '  ')},`,
    `  "arrivals": ${list(checked.arrivals, '  ')}`,
    '}',
    '',
  ].join('\n');
}
