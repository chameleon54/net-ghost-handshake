import { dirToWorld, worldBounds } from './boxShape';
import type { LevelBox, LevelData } from './levelData';
import { locate, markerHeightM, markerWidthM, moveMany, picked, rayBoxM, turnByMany, type Pick } from './levelEdit';

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
/** The rotate ring (5.5a): its radius, and how far either side of it still counts as aiming at it (in gizmo lengths). */
export const ringRadius = 1.3;
const ringBand = 0.12;
/** Looking this flat at the ring's plane, it is edge-on and cannot be aimed at. */
const ringMinSlope = 0.08;

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
 * `minBoxSizeM`, and the bottom never goes below the floor. Not a box, or no such item: the level as it is. The faces are
 * the box's own: on a turned box (5.5a) "east" is its own +x.
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
  if (axis !== 'y') {
    const shift = dirToWorld(box, axis === 'x' ? (sign * d) / 2 : 0, axis === 'z' ? (sign * d) / 2 : 0); // the centre moves half as far, along the box's own axis
    next.xM = box.xM + shift.x;
    next.zM = box.zM + shift.z;
  }
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
      ({ min: lo, max: hi } = worldBounds(item as LevelBox)); // a turned box's square outline
    } else {
      lo = { x: item.xM - markerWidthM / 2, y: 0, z: item.zM - markerWidthM / 2 };
      hi = { x: item.xM + markerWidthM / 2, y: markerHeightM, z: item.zM + markerWidthM / 2 };
    }
    min = min ? { x: Math.min(min.x, lo.x), y: Math.min(min.y, lo.y), z: Math.min(min.z, lo.z) } : { ...lo };
    max = max ? { x: Math.max(max.x, hi.x), y: Math.max(max.y, hi.y), z: Math.max(max.z, hi.z) } : { ...hi };
  }
  return min && max ? { min, max } : null;
}

/** One arrow (moves the selection along an axis), handle (pulls one face of a box out or in) or the rotate ring (turns it). */
export interface GizmoHandle {
  key: string;
  kind: 'move' | 'size' | 'turn';
  /** The world axis an arrow moves along; for a handle, the box's own axis its face is square to. */
  axis: Axis;
  /** The + way of the line a drag follows, in the world (a turned box's handles follow its own axes). */
  dir: Vec3;
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
 * a box is selected (markers stand on the floor), and the rotate ring round them (5.5a). `size`: six handles on the box's
 * own faces, only when exactly one box is selected.
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
      handles.push({ key: `move-${axis}`, kind: 'move', axis, dir: unit(axis), sign: 1, origin: centre, at: tip, scale, ...around(at(centre, axis, scale * arrowStart), tip, scale * aimSlack) });
    }
    const r = scale * ringRadius;
    handles.push({ key: 'turn', kind: 'turn', axis: 'y', dir: unit('y'), sign: 1, origin: centre, at: centre, scale, min: { x: centre.x - r, y: centre.y, z: centre.z - r }, max: { x: centre.x + r, y: centre.y, z: centre.z + r } });
    return handles;
  }
  const only = ids.length === 1 && locate(level, ids[0])?.list === 'boxes';
  if (!only) return [];
  const box = picked(level, ids[0]) as LevelBox;
  const boxCentre = { x: box.xM, y: (box.yM ?? 0) + box.heightM / 2, z: box.zM };
  const halfOf: Record<Axis, number> = { x: box.widthM / 2, y: box.heightM / 2, z: box.depthM / 2 };
  const step = (from: Vec3, dir: Vec3, metres: number): Vec3 => ({ x: from.x + dir.x * metres, y: from.y + dir.y * metres, z: from.z + dir.z * metres });
  for (const face of Object.keys(faceAxes) as Face[]) {
    const { axis, sign } = faceAxes[face];
    const flat = axis === 'y' ? null : dirToWorld(box, axis === 'x' ? 1 : 0, axis === 'z' ? 1 : 0); // the box's own axis, turned with it
    const dir = flat ? { x: flat.x, y: 0, z: flat.z } : unit('y');
    const faceCentre = step(boxCentre, dir, sign * halfOf[axis]);
    const cube = step(faceCentre, dir, sign * scale * handleOffset);
    const half = scale * (handleHalf + aimSlack);
    handles.push({
      key: `size-${face}`,
      kind: 'size',
      axis,
      dir,
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

/**
 * Where the ray meets the rotate ring's flat plane, as an angle round its centre in radians (0 is +x, growing as a yaw
 * does: to the left seen from above), and how far along the ray that is. Null if the ray runs too flat to the plane or
 * meets it behind the eye.
 */
export function ringAngle(handle: GizmoHandle, origin: Vec3, dir: Vec3): { angleRad: number; alongM: number; fromCentreM: number } | null {
  if (Math.abs(dir.y) < ringMinSlope) return null;
  const alongM = (handle.origin.y - origin.y) / dir.y;
  if (alongM <= 0) return null;
  const dx = origin.x + dir.x * alongM - handle.origin.x;
  const dz = origin.z + dir.z * alongM - handle.origin.z;
  return { angleRad: Math.atan2(-dz, dx), alongM, fromCentreM: Math.hypot(dx, dz) };
}

/** The nearest handle the ray (unit `dir`) hits, or null. The ring counts where the ray crosses its band. */
export function pickHandle(handles: readonly GizmoHandle[], origin: Vec3, dir: Vec3): GizmoHandle | null {
  let best: GizmoHandle | null = null;
  let bestM = Infinity;
  for (const handle of handles) {
    let m = Infinity;
    if (handle.kind === 'turn') {
      const hit = ringAngle(handle, origin, dir);
      if (hit && Math.abs(hit.fromCentreM - handle.scale * ringRadius) <= handle.scale * ringBand) m = hit.alongM;
    } else {
      m = rayBoxM(origin, dir, handle.min, handle.max);
    }
    if (m < bestM) {
      best = handle;
      bestM = m;
    }
  }
  return best;
}

/**
 * What dragging a handle does to the level as it was when the drag began: `amount` is metres along its line for an arrow or
 * handle, degrees (to the left) for the ring, which turns each selected piece about its own centre.
 */
export function applyHandleDrag(before: LevelData, ids: readonly Pick[], handle: GizmoHandle, amount: number): LevelData {
  const alongM = amount;
  if (handle.kind === 'turn') return turnByMany(before, ids, amount);
  if (handle.kind === 'move') return moveAlong(before, ids, handle.axis, alongM);
  return handle.face ? resizeFace(before, ids[0], handle.face, handle.sign * alongM) : before; // a face pulled outward is a positive change
}

export { handleHalf as handleHalfSize, handleOffset, arrowStart };
