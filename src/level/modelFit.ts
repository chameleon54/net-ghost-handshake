import * as THREE from 'three';
import type { RoomBox } from '../data/greyboxRoom';

// Models on boxes (5.5b, decision 287). A box may carry a `model`: the box stays the collision, cover and route truth, and
// the model is only its skin, scaled evenly to fit inside it, standing on its base, centred and turned with it. This file
// is the maths and the names, with no loading and no drawing, so it can be tested; src/level/models.ts loads and draws.

/** A game model: a file `src/assets/models/<name>.glb` (Part 2 of 5.5b copies the chosen kit's pieces there). */
export const gameModelPattern = /^prop-[a-z0-9-]+$/;
/** A kit model, for trying kits on the dev server only: `kit:<kit folder>/<path to the file>` in the kits folder. */
export const kitPrefix = 'kit:';
/** The dev server's kits endpoints (the names match vite.config.ts). */
export const kitListUrl = '/__kits/list';
export const kitFilesUrl = '/__kits/file/';
export const kitCopyUrl = '/__kits/copy';
/** A model may be turned inside its box by quarter turns, since kits do not agree on which way a piece faces. */
export const modelTurnsDeg: readonly number[] = [0, 90, 180, 270];
/** How a model fills its box: one copy scaled evenly ("even", left out of the file), or copies along its longest side ("repeat"). */
export type ModelFit = 'even' | 'repeat';

/** The asset rules for a prop (assets.md): under this many triangles, textures no wider than this. */
export const propTriangleBudget = 2000;
export const maxTexturePx = 1024;
/** All of the lab's models together (decision 286: 8 MB of the 30 MB needed to start a wave). */
export const levelModelsBudgetBytes = 8_000_000;

export const isKitModel = (name: string): boolean => name.startsWith(kitPrefix) && name.length > kitPrefix.length;
export const isModelName = (name: string): boolean => gameModelPattern.test(name) || isKitModel(name);

/** The model's size along the box's own width (x), height (y) and depth (z), once turned inside the box. */
function turnedSize(bounds: THREE.Box3, modelYawDeg: number): THREE.Vector3 {
  const size = bounds.getSize(new THREE.Vector3());
  return modelYawDeg % 180 === 0 ? size : new THREE.Vector3(size.z, size.y, size.x);
}

/** The even scale that makes the model fit inside the box (the tightest of the three directions). */
export function fitScale(box: RoomBox, bounds: THREE.Box3, modelYawDeg = 0): number {
  const size = turnedSize(bounds, modelYawDeg);
  // A flat model (a decal) has no size in one direction; that direction cannot limit the scale.
  const limits = [box.widthM / size.x, box.heightM / size.y, box.depthM / size.z].filter(Number.isFinite);
  return limits.length > 0 ? Math.min(...limits) : 1;
}

/** Where the model is drawn: centred on the box, standing on its base, turned with it, scaled evenly to fit inside it. */
export function modelMatrix(box: RoomBox, bounds: THREE.Box3, modelYawDeg = 0, target = new THREE.Matrix4()): THREE.Matrix4 {
  return placeModel(box, bounds, modelYawDeg, fitScale(box, bounds, modelYawDeg), new THREE.Vector3(), target);
}

/** One copy of the model: scaled by `scale`, its base's middle at the box's base centre moved by `offset` (in the box's own axes), turned with the box. */
function placeModel(box: RoomBox, bounds: THREE.Box3, modelYawDeg: number, scale: number, offset: THREE.Vector3, target: THREE.Matrix4): THREE.Matrix4 {
  const centre = bounds.getCenter(new THREE.Vector3());
  const toPivot = new THREE.Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z); // the middle of the model's base
  const boxTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((box.yawDeg ?? 0) * Math.PI) / 180);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (((box.yawDeg ?? 0) + modelYawDeg) * Math.PI) / 180);
  const position = offset.clone().applyQuaternion(boxTurn).add(new THREE.Vector3(box.xM, box.yM ?? 0, box.zM));
  return target.compose(position, turn, new THREE.Vector3(scale, scale, scale)).multiply(toPivot);
}

/**
 * Every copy of the model a box draws. `fit` "even" (the default): one copy, as `modelMatrix`. "repeat" (5.5b Part 2,
 * decision 289): copies side by side along the box's longest side (a counter unit along a bench, shelf boxes stacked in a
 * tall cabinet), as many as needed to fill it, each scaled evenly so the row is exactly as long as the box and no copy is
 * bigger than the box's other two sides.
 */
export function modelMatrices(box: RoomBox, bounds: THREE.Box3, modelYawDeg = 0, fit: ModelFit = 'even'): THREE.Matrix4[] {
  const row = repeatRow(box, bounds, modelYawDeg, fit);
  if (!row) return [modelMatrix(box, bounds, modelYawDeg)];
  const { axis, count, scale, lengthM } = row;
  const stepM = lengthM / count;
  return Array.from({ length: count }, (_, k) => {
    const offset = new THREE.Vector3();
    // Along the floor the copies are centred in their share of the length; upward each stands on the one below.
    offset[axis] = axis === 'y' ? k * stepM : -lengthM / 2 + (k + 0.5) * stepM;
    return placeModel(box, bounds, modelYawDeg, scale, offset, new THREE.Matrix4());
  });
}

/** How a "repeat" box lays its copies: along which of its own axes, how many, at what scale; null when it draws one copy. */
function repeatRow(box: RoomBox, bounds: THREE.Box3, modelYawDeg: number, fit: ModelFit): { axis: 'x' | 'y' | 'z'; count: number; scale: number; lengthM: number } | null {
  if (fit !== 'repeat') return null;
  const boxSize = new THREE.Vector3(box.widthM, box.heightM, box.depthM);
  const size = turnedSize(bounds, modelYawDeg);
  const axes = ['x', 'y', 'z'] as const;
  const axis = axes.reduce((longest, next) => (boxSize[next] > boxSize[longest] ? next : longest));
  const across = axes.filter((other) => other !== axis).map((other) => boxSize[other] / size[other]).filter(Number.isFinite);
  const fitAcross = across.length > 0 ? Math.min(...across) : 1;
  const unitM = size[axis] * fitAcross;
  if (!(unitM > 0)) return null; // the model has no length that way: one copy
  const count = Math.max(1, Math.ceil(boxSize[axis] / unitM - 1e-9)); // rounded up, so the copies shrink to fit rather than poke out
  return { axis, count, scale: boxSize[axis] / (count * size[axis]), lengthM: boxSize[axis] };
}

/**
 * "Fit box to model": the box's size once shrunk to the fitted model (its centre and base stay where they are), no side
 * under `minSizeM`. A "repeat" box keeps its length and shrinks its other two sides to the row of copies.
 */
export function boxSizeFittedToModel(box: RoomBox, bounds: THREE.Box3, modelYawDeg: number, minSizeM: number, fit: ModelFit = 'even'): { widthM: number; depthM: number; heightM: number } {
  const row = repeatRow(box, bounds, modelYawDeg, fit);
  const size = turnedSize(bounds, modelYawDeg).multiplyScalar(row ? row.scale : fitScale(box, bounds, modelYawDeg));
  if (row) size[row.axis] = row.lengthM;
  return { widthM: Math.max(minSizeM, size.x), depthM: Math.max(minSizeM, size.z), heightM: Math.max(minSizeM, size.y) };
}
