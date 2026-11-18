import { Vector3 } from 'three';
import { levelCover } from './cover';
import type { LevelData } from './levelData';
import type { Navigation } from './navigation';

// The level editor's reach check (5.2b, decision 281): after an edit, can the enemies and Rook still walk to every part
// of the level? It is asked of navigation meshes the editor builds from its own copy of the level (the game's own keep
// the saved layout until Save). Rook's mesh is built for his crouched body on foot: a place he can only reach by climbing
// counts as unreachable for him. Plain functions, no drawing; src/debug/editMode.ts draws the result.

/** One thing that cannot be reached. `key` names it the same way from one check to the next, so new problems can be told apart. */
export interface ReachProblem {
  readonly kind: 'start-off-floor' | 'cover-off-floor' | 'cover-no-route' | 'spawn-no-route' | 'enemy-pocket' | 'rook-pocket';
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A route that ends this close to its goal reached it. */
const reachedM = 0.5;
/** A cover spot counts as on the floor if the mesh is this close to it sideways... */
const onFloorSidewaysM = 0.05;
/** ...and up or down (as the game's own filter, main.ts). */
const onFloorUpDownM = 0.5;
/** Unreachable floor is reported in cells this big, so one closed-off area is a few lines, not hundreds. */
const pocketCellM = 1;
/** Unreachable floor counts as a closed-off part of a floor only within this height of floor that can be reached (a prop's top does not). */
const sameFloorM = 0.3;
/** A mesh triangle this level (its normal's up part) is floor; a steeper one is a ramp or stair. */
const flatUp = 0.99;

const at = new Vector3();
const onMesh = new Vector3();
const route: Vector3[] = [];

/** True if `navigation` has a route from `from` that ends within reach of `to`. */
function reaches(navigation: Navigation, from: Vector3, to: Vector3): boolean {
  return navigation.findPath(from, to, route) && route[route.length - 1].distanceTo(to) <= reachedM;
}

/**
 * The parts of the floor `navigation` has that cannot be reached from `start`, one problem per cell. Prop tops (separate
 * patches nobody walks onto) are left out: only unreachable floor at the height of floor that can be reached counts.
 */
function pockets(navigation: Navigation, start: Vector3, kind: 'enemy-pocket' | 'rook-pocket'): ReachProblem[] {
  const [positions, indices] = navigation.triangles();
  const reachedHeights: number[] = [];
  const unreached: Vector3[] = [];
  const seenCells = new Set<string>();
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => new Vector3(positions[indices[i + k] * 3], positions[indices[i + k] * 3 + 1], positions[indices[i + k] * 3 + 2]));
    const up = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    if (Math.abs(up.y) < flatUp) continue; // a ramp: its heights run through every floor's, so only flat floor is judged
    const centre = a.add(b).add(c).divideScalar(3);
    const cell = `${Math.round(centre.x / pocketCellM)},${Math.round(centre.y * 10)},${Math.round(centre.z / pocketCellM)}`;
    if (seenCells.has(cell)) continue; // one sample per cell is enough
    seenCells.add(cell);
    if (!navigation.closestPoint(centre, onMesh)) continue;
    if (reaches(navigation, start, onMesh)) reachedHeights.push(onMesh.y);
    else unreached.push(onMesh.clone());
  }
  const problems = new Map<string, ReachProblem>();
  for (const p of unreached) {
    if (!reachedHeights.some((y) => Math.abs(y - p.y) <= sameFloorM)) continue;
    const key = `${kind}:${Math.round(p.x / pocketCellM)},${Math.round(p.y)},${Math.round(p.z / pocketCellM)}`;
    if (!problems.has(key)) problems.set(key, { kind, key, x: p.x, y: p.y, z: p.z });
  }
  return [...problems.values()];
}

/**
 * Everything in `level` that cannot be reached: Rook's start off the floor; generated cover spots off the walkable floor or
 * with no route from the start; spawns with no route to the start; and closed-off parts of the floor, for the enemies
 * (`enemies`, their mesh) and for Rook on foot (`rook`, his).
 */
export function reachProblems(level: LevelData, enemies: Navigation, rook: Navigation): ReachProblem[] {
  const problems: ReachProblem[] = [];
  const start = new Vector3(level.start.xM, 0, level.start.zM);
  if (!enemies.closestPoint(start, onMesh) || Math.hypot(onMesh.x - start.x, onMesh.z - start.z) > reachedM) {
    return [{ kind: 'start-off-floor', key: 'start', x: start.x, y: 0, z: start.z }]; // nothing else can be judged from it
  }
  for (const point of levelCover(level)) {
    const y = point.yM ?? 0;
    const key = `${point.xM.toFixed(2)},${y.toFixed(2)},${point.zM.toFixed(2)}`;
    at.set(point.xM, y, point.zM);
    const onFloor = enemies.closestPoint(at, onMesh) && Math.hypot(onMesh.x - at.x, onMesh.z - at.z) < onFloorSidewaysM && Math.abs(onMesh.y - at.y) < onFloorUpDownM;
    if (!onFloor) problems.push({ kind: 'cover-off-floor', key: `cover-off-floor:${key}`, x: at.x, y, z: at.z });
    else if (!reaches(enemies, start, at.clone())) problems.push({ kind: 'cover-no-route', key: `cover-no-route:${key}`, x: at.x, y, z: at.z });
  }
  for (const spawn of level.spawns) {
    if (!reaches(enemies, new Vector3(spawn.xM, 0, spawn.zM), start)) problems.push({ kind: 'spawn-no-route', key: `spawn-no-route:${spawn.id}`, x: spawn.xM, y: 0, z: spawn.zM });
  }
  problems.push(...pockets(enemies, start, 'enemy-pocket'), ...pockets(rook, start, 'rook-pocket'));
  return problems;
}

/** The problems in `now` that were not in `before` (the layout as loaded): what the edits broke. */
export function newSince(now: readonly ReachProblem[], before: readonly ReachProblem[]): ReachProblem[] {
  const old = new Set(before.map((p) => p.key));
  return now.filter((p) => !old.has(p.key));
}

/** The label of the box nearest (x, z) at about height y, to say where a problem is ("by prep bench A"). */
export function nearestLabel(level: LevelData, x: number, y: number, z: number): string {
  let best = '';
  let bestM = Infinity;
  for (const box of level.boxes) {
    if (box.drawn === false) continue; // a stair's hidden ramp says nothing to the reader
    const dx = Math.max(Math.abs(x - box.xM) - box.widthM / 2, 0);
    const dz = Math.max(Math.abs(z - box.zM) - box.depthM / 2, 0);
    const bottom = box.yM ?? 0;
    const dy = y < bottom ? bottom - y : y > bottom + box.heightM ? y - bottom - box.heightM : 0;
    const m = Math.hypot(dx, dy, dz);
    if (m < bestM) {
      best = box.label;
      bestM = m;
    }
  }
  return best;
}

/** The report in a few lines: what is new since the layout was loaded, with where it is; the old ones only counted. */
export function describeReach(level: LevelData, now: readonly ReachProblem[], fresh: readonly ReachProblem[]): string[] {
  if (now.length > 0 && now[0].kind === 'start-off-floor') return ["Rook's start is not on the walkable floor: nothing can be checked"];
  const count = (list: readonly ReachProblem[], kind: ReachProblem['kind']) => list.filter((p) => p.kind === kind).length;
  const where = (p: ReachProblem) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}${p.y > 1 ? ', upstairs' : ''}) by ${nearestLabel(level, p.x, p.y, p.z)}`;
  const names: Record<ReachProblem['kind'], string> = {
    'start-off-floor': "Rook's start off the floor",
    'cover-off-floor': 'cover spot not on the walkable floor',
    'cover-no-route': 'cover spot enemies cannot walk to',
    'spawn-no-route': 'spawn with no route to the start',
    'enemy-pocket': 'm² (about) of floor enemies cannot walk to',
    'rook-pocket': 'm² (about) of floor Rook cannot walk to (climbing not counted)',
  };
  const kinds = Object.keys(names) as ReachProblem['kind'][];
  const lines = [
    fresh.length === 0 ? 'nothing new is out of reach' : `NEW since loaded: ${kinds.filter((k) => count(fresh, k) > 0).map((k) => `${count(fresh, k)} ${names[k]}`).join('; ')}`,
    ...fresh.slice(0, 6).map((p) => `  ${names[p.kind]} ${where(p)}`),
    ...(fresh.length > 6 ? [`  ...and ${fresh.length - 6} more (red in the view)`] : []),
    `${now.length - fresh.length} already out of reach as loaded (the ground outside the hall, prop tops; not shown)`,
  ];
  return lines;
}
