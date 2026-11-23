import type { LevelBox, LevelData } from './levelData';
import { locate, markerHeightM, markerWidthM, moveMany, picked, rayBoxM, type Pick } from './levelEdit';

// The maths of the editor's arrows and handles (milestone 5.2c, decision 285): where they are, which one the dot is aimed
// at, and what dragging one does. Plain functions with no drawing, so they can be tested; src/debug/gizmoView.ts draws them
// and src/debug/editMode.ts drives them. A drag follows an axis line: the editor casts a ray through a virtual cursor and
// this finds the point of the axis nearest to it, so the piece stays under the cursor along that axis.

export type Axis = 'x' | 'y' | 'z';
/** The six faces of a box: east is +x, south is +z (north is -z, as everywhere), top is +y. */
export type Face = 'east' | 'west' | 'south' | 'north' | 'top' | 'bottom';

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Which way each face points: the axis it is square to, and + or - along it. */
export const faceAxes: Record<Face, { axis: Axis; sign: 1 | -1 }> = {
  east: { axis: 'x', sign: 1 },
  west: { axis: 'x', sign: -1 },
  south: { axis: 'z', sign: 1 },
  north: { axis: 'z', sign: -1 },
  top: { axis: 'y', sign: 1 },
  bottom: { axis: 'y', sign: -1 },
};

/** A box is never made smaller than this by a handle. */
export const minBoxSizeM = 0.1;
/** The arrows and handles stay this share of the distance to the camera long, so they look the same size near and far. */
export const gizmoScreenShare = 0.12;
/** A handle's cube stands this far (in gizmo lengths) outside its face, and is this wide (half). */
const handleOffset = 0.15;
const handleHalf = 0.07;
/** The aim box of an arrow or handle is this much bigger than what is drawn, so it is easy to aim at. */
const aimSlack = 0.08;
/** An arrow's shaft starts this far (in gizmo lengths) from the centre. */
const arrowStart = 0.3;

const axes: readonly Axis[] = ['x', 'y', 'z'];
const unit = (axis: Axis, sign = 1): Vec3 => ({ x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 });

/**
 * Where along an axis line (`axisOrigin`, unit `axisDir`) the point nearest to a ray (`origin`, unit `dir`) is, in metres from
 * `axisOrigin`. Null if the ray is parallel to the axis (it points along it, so there is no one answer) or the nearest point
 * of the ray is behind the eye.
 */
export function closestOnAxis(origin: Vec3, dir: Vec3, axisOrigin: Vec3, axisDir: Vec3): number | null {
  const w = { x: origin.x - axisOrigin.x, y: origin.y - axisOrigin.y, z: origin.z - axisOrigin.z };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const b = dot(dir, axisDir);
  const denom = 1 - b * b; // both are unit vectors
  if (denom < 1e-6) return null;
  const d = dot(dir, w);
  const e = dot(axisDir, w);
  const alongRay = (b * e - d) / denom; // where on the ray the nearest point is
  if (alongRay < 0) return null;
  return (e - b * d) / denom;
}

/**
 * The box with one face pushed `deltaM` outward (negative: pulled in); the opposite face stays where it is. Never under
 * `minBoxSizeM`, and the bottom never goes below the floor. Not a box, or no such item: the level as it is.
 */
export function resizeFace(level: LevelData, id: Pick, face: Face, deltaM: number): LevelData {
  const at = locate(level, id);
  if (!at || at.list !== 'boxes') return level;
  const box = level.boxes[at.index];
  const { axis, sign } = faceAxes[face];
  const sizeKey = axis === 'x' ? 'widthM' : axis === 'z' ? 'depthM' : 'heightM';
  let d = Math.max(deltaM, minBoxSizeM - box[sizeKey]);
  if (face === 'bottom') d = Math.min(d, box.yM ?? 0); // growing down cannot pass the floor
  const next: LevelBox = { ...box, [sizeKey]: box[sizeKey] + d };
  if (axis === 'x') next.xM = box.xM + (sign * d) / 2;
  if (axis === 'z') next.zM = box.zM + (sign * d) / 2;
  if (face === 'bottom') {
    const yM = (box.yM ?? 0) - d;
    if (yM > 1e-9) next.yM = yM;
    else delete next.yM;
  }
  const boxes = level.boxes.slice();
  boxes[at.index] = next;
  return { ...level, boxes };
}

/** Moves every selected item `deltaM` along one axis (markers ignore y). */
export function moveAlong(level: LevelData, ids: readonly Pick[], axis: Axis, deltaM: number): LevelData {
  return moveMany(level, ids, axis === 'x' ? deltaM : 0, axis === 'y' ? deltaM : 0, axis === 'z' ? deltaM : 0);
}

/** The box around everything selected (markers count as upright posts), or null if nothing selected exists any more. */
export function selectionBounds(level: LevelData, ids: readonly Pick[]): { min: Vec3; max: Vec3 } | null {
  let min: { x: number; y: number; z: number } | null = null;
  let max: { x: number; y: number; z: number } | null = null;
  for (const id of ids) {
    const item = picked(level, id);
    if (!item) continue;
    let lo: Vec3;
    let hi: Vec3;
    if (locate(level, id)?.list === 'boxes') {
      const box = item as LevelBox;
      lo = { x: box.xM - box.widthM / 2, y: box.yM ?? 0, z: box.zM - box.depthM / 2 };
      hi = { x: box.xM + box.widthM / 2, y: (box.yM ?? 0) + box.heightM, z: box.zM + box.depthM / 2 };
    } else {
      lo = { x: item.xM - markerWidthM / 2, y: 0, z: item.zM - markerWidthM / 2 };
      hi = { x: item.xM + markerWidthM / 2, y: markerHeightM, z: item.zM + markerWidthM / 2 };
    }
    min = min ? { x: Math.min(min.x, lo.x), y: Math.min(min.y, lo.y), z: Math.min(min.z, lo.z) } : { ...lo };
    max = max ? { x: Math.max(max.x, hi.x), y: Math.max(max.y, hi.y), z: Math.max(max.z, hi.z) } : { ...hi };
  }
  return min && max ? { min, max } : null;
}

/** One arrow (moves the selection along an axis) or handle (pulls one face of a box out or in). */
export interface GizmoHandle {
  key: string;
  kind: 'move' | 'size';
  axis: Axis;
  /** A size handle's face (the one it pulls). */
  face?: Face;
  /** + or - along `axis`: the way an arrow points, or the way a face's outside lies. */
  sign: 1 | -1;
  /** A point on the line the drag follows: the selection's centre for an arrow, the face's centre for a handle. */
  origin: Vec3;
  /** Where it is drawn: an arrow's tip, a handle's cube. */
  at: Vec3;
  /** How long one gizmo unit is here (grows with the camera's distance). */
  scale: number;
  /** The box the dot must be inside to aim at it. */
  min: Vec3;
  max: Vec3;
}

/**
 * The arrows or handles for what is selected, sized by the distance to the camera. `move`: an arrow on x and z, and on y if
 * a box is selected (markers stand on the floor). `size`: six handles, only when exactly one box is selected.
 */
export function layoutGizmo(level: LevelData, ids: readonly Pick[], mode: 'move' | 'size', camera: Vec3): GizmoHandle[] {
  const bounds = selectionBounds(level, ids);
  if (!bounds) return [];
  const centre = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
  const scale = Math.max(Math.hypot(camera.x - centre.x, camera.y - centre.y, camera.z - centre.z), 1) * gizmoScreenShare;
  const handles: GizmoHandle[] = [];
  const at = (from: Vec3, axis: Axis, metres: number): Vec3 => ({ x: from.x + unit(axis).x * metres, y: from.y + unit(axis).y * metres, z: from.z + unit(axis).z * metres });
  const around = (a: Vec3, b: Vec3, slack: number): { min: Vec3; max: Vec3 } => ({
    min: { x: Math.min(a.x, b.x) - slack, y: Math.min(a.y, b.y) - slack, z: Math.min(a.z, b.z) - slack },
    max: { x: Math.max(a.x, b.x) + slack, y: Math.max(a.y, b.y) + slack, z: Math.max(a.z, b.z) + slack },
  });
  if (mode === 'move') {
    const anyBox = ids.some((id) => locate(level, id)?.list === 'boxes');
    for (const axis of axes) {
      if (axis === 'y' && !anyBox) continue;
      const tip = at(centre, axis, scale);
      handles.push({ key: `move-${axis}`, kind: 'move', axis, sign: 1, origin: centre, at: tip, scale, ...around(at(centre, axis, scale * arrowStart), tip, scale * aimSlack) });
    }
    return handles;
  }
  const only = ids.length === 1 && locate(level, ids[0])?.list === 'boxes';
  if (!only) return [];
  for (const face of Object.keys(faceAxes) as Face[]) {
    const { axis, sign } = faceAxes[face];
    const faceCentre = at(centre, axis, (sign * (bounds.max[axis] - bounds.min[axis])) / 2);
    const cube = at(faceCentre, axis, sign * scale * handleOffset);
    const half = scale * (handleHalf + aimSlack);
    handles.push({
      key: `size-${face}`,
      kind: 'size',
      axis,
      face,
      sign,
      origin: faceCentre,
      at: cube,
      scale,
      min: { x: cube.x - half, y: cube.y - half, z: cube.z - half },
      max: { x: cube.x + half, y: cube.y + half, z: cube.z + half },
    });
  }
  return handles;
}

/** The nearest handle the ray (unit `dir`) hits, or null. */
export function pickHandle(handles: readonly GizmoHandle[], origin: Vec3, dir: Vec3): GizmoHandle | null {
  let best: GizmoHandle | null = null;
  let bestM = Infinity;
  for (const handle of handles) {
    const m = rayBoxM(origin, dir, handle.min, handle.max);
    if (m < bestM) {
      best = handle;
      bestM = m;
    }
  }
  return best;
}

/** What dragging a handle `alongM` metres along its axis does to the level as it was when the drag began. */
export function applyHandleDrag(before: LevelData, ids: readonly Pick[], handle: GizmoHandle, alongM: number): LevelData {
  if (handle.kind === 'move') return moveAlong(before, ids, handle.axis, alongM);
  return handle.face ? resizeFace(before, ids[0], handle.face, handle.sign * alongM) : before; // a face pulled outward is a positive change
}

export { handleHalf as handleHalfSize, handleOffset, arrowStart };
