import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { LevelBox } from './levelData';
import { isKitModel, kitFilesUrl, kitPrefix, modelMatrix } from './modelFit';

// Loads the models boxes are drawn with and draws them (5.5b, decision 287). The fitting maths is in modelFit.ts. A model
// that cannot load never stops the game: its boxes are drawn grey as before, and the console names it.

/** A model as loaded: its meshes flattened into its own space (so each part can be instanced), its bounds and its size. */
export interface LoadedModel {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[];
  bounds: THREE.Box3;
  triangles: number;
}

/** The game's own model files, by path (empty until 5.5b Part 2 copies the chosen kit's pieces in). */
const gameModelUrls = import.meta.glob<string>('../assets/models/*.glb', { query: '?url', import: 'default', eager: true });

/** Where a model's file is fetched from; null if there is no such file (a kit model outside the dev server, or a typo). */
export function modelUrl(name: string): string | null {
  if (isKitModel(name)) return import.meta.env.DEV ? kitFilesUrl + name.slice(kitPrefix.length).split('/').map(encodeURIComponent).join('/') : null;
  return gameModelUrls[`../assets/models/${name}.glb`] ?? null;
}

/** Whether the game draws this box as its model (a stair's hidden ramp and glass never are). */
export const drawsModel = (box: LevelBox): boolean => box.model !== undefined && box.drawn !== false && !box.glass;

const loaded = new Map<string, Promise<LoadedModel>>();

/** Loads a model once; later calls get the same one. */
export function loadModel(name: string): Promise<LoadedModel> {
  let model = loaded.get(name);
  if (!model) {
    model = load(name);
    loaded.set(name, model);
  }
  return model;
}

async function load(name: string): Promise<LoadedModel> {
  const url = modelUrl(name);
  if (!url) throw new Error(`There is no model file for "${name}"`);
  const root = /\.obj$/i.test(url) ? await loadObj(url) : (await new GLTFLoader().loadAsync(url)).scene;
  return flattenModel(root);
}

/** An OBJ file (only some kits come without glTF), with the materials of the .mtl beside it if there is one. Its loaders are fetched only when needed. */
async function loadObj(url: string): Promise<THREE.Object3D> {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([import('three/addons/loaders/OBJLoader.js'), import('three/addons/loaders/MTLLoader.js')]);
  const loader = new OBJLoader();
  try {
    const materials = await new MTLLoader().loadAsync(url.replace(/\.obj$/i, '.mtl'));
    materials.preload();
    loader.setMaterials(materials);
  } catch {
    // No .mtl: the OBJ loader's plain material.
  }
  return loader.loadAsync(url);
}

/** Every mesh's geometry moved into the model's own space, so the model can be drawn as instances of plain parts. */
export function flattenModel(root: THREE.Object3D): LoadedModel {
  root.updateMatrixWorld(true);
  const model: LoadedModel = { parts: [], bounds: new THREE.Box3(), triangles: 0 };
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    // Props never animate, and an instanced mesh has no morph weights: drawing one with morph targets throws and stops
    // the game (a Lab Assets extinguisher has one). So the model is kept in its rest shape.
    geometry.morphAttributes = {};
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    model.bounds.union(geometry.boundingBox!);
    model.parts.push({ geometry, material: mesh.material });
    model.triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  });
  if (model.parts.length === 0) throw new Error('The file has no meshes');
  return model;
}

/** Loads every model the level's boxes are drawn with, before the first frame. One that fails is left out (its boxes stay grey). */
export async function loadLevelModels(boxes: readonly LevelBox[]): Promise<Map<string, LoadedModel>> {
  const names = new Set(boxes.filter(drawsModel).map((box) => box.model!));
  const models = new Map<string, LoadedModel>();
  await Promise.all(
    [...names].map(async (name) => {
      try {
        models.set(name, await loadModel(name));
      } catch (error) {
        console.warn(`Model "${name}" could not load; its boxes are drawn grey.`, error);
      }
    }),
  );
  return models;
}

/** The boxes drawn as a model: those that want one whose model has loaded. The grey-box builder leaves these out. */
export function modelledBoxes(boxes: readonly LevelBox[], models: ReadonlyMap<string, LoadedModel>): LevelBox[] {
  return boxes.filter((box) => drawsModel(box) && models.has(box.model!));
}

/** The modelled boxes drawn: one instanced mesh per part of each model, so ten benches of one model cost what one costs. */
export function drawBoxModels(boxes: readonly LevelBox[], models: ReadonlyMap<string, LoadedModel>): THREE.InstancedMesh[] {
  const byModel = new Map<string, LevelBox[]>();
  for (const box of modelledBoxes(boxes, models)) byModel.set(box.model!, [...(byModel.get(box.model!) ?? []), box]);
  const meshes: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  for (const [name, users] of byModel) {
    const model = models.get(name)!;
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, users.length);
      users.forEach((box, i) => mesh.setMatrixAt(i, modelMatrix(box, model.bounds, box.modelYawDeg ?? 0, matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); // over all the instances, so the whole set is culled correctly
      meshes.push(mesh);
    }
  }
  return meshes;
}
