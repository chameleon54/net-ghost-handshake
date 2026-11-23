import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RoomBox } from '../src/data/greyboxRoom';
import { checkLevel, LevelError, levelToJson } from '../src/level/levelData';
import { boxSizeFittedToModel, fitScale, gameModelPattern, isKitModel, modelMatrices, modelMatrix } from '../src/level/modelFit';
import { disposeModel, drawBoxModels, flattenModel } from '../src/level/models';

// Models on boxes (5.5b, decision 287): the model is fitted inside its box, and the level files only use game models.

/** A model 2 m wide, 1 m tall and 0.5 m deep whose own origin is not at its middle (kits put it anywhere). */
const bounds = new THREE.Box3(new THREE.Vector3(-0.5, 0.25, 1), new THREE.Vector3(1.5, 1.25, 1.5));
const bench: RoomBox = { kind: 'prop', xM: 5, zM: -3, widthM: 1, depthM: 1, heightM: 1 };

/** The model's corners where the matrix draws them. */
function drawnBounds(matrix: THREE.Matrix4): THREE.Box3 {
  return bounds.clone().applyMatrix4(matrix);
}

describe('fitting a model inside its box', () => {
  it('scales evenly by the tightest direction', () => {
    expect(fitScale(bench, bounds)).toBeCloseTo(0.5); // 2 m wide into 1 m
    expect(fitScale({ ...bench, widthM: 4 }, bounds)).toBeCloseTo(1); // now the height limits it
  });

  it('stands on the box base, centred on the box', () => {
    const drawn = drawnBounds(modelMatrix({ ...bench, yM: 0.8 }, bounds));
    const centre = drawn.getCenter(new THREE.Vector3());
    expect(centre.x).toBeCloseTo(5);
    expect(centre.z).toBeCloseTo(-3);
    expect(drawn.min.y).toBeCloseTo(0.8);
    const size = drawn.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1);
    expect(size.y).toBeCloseTo(0.5);
    expect(size.z).toBeCloseTo(0.25);
  });

  it('a quarter turn inside the box fits the model the other way', () => {
    expect(fitScale({ ...bench, widthM: 0.5, depthM: 2, heightM: 2 }, bounds, 90)).toBeCloseTo(1);
    const size = drawnBounds(modelMatrix({ ...bench, widthM: 0.5, depthM: 2, heightM: 2 }, bounds, 90)).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.5);
    expect(size.z).toBeCloseTo(2);
  });

  it('turns with a turned box and stays inside it', () => {
    const turned = { ...bench, widthM: 2, depthM: 0.5, heightM: 1, yawDeg: 30 };
    const matrix = modelMatrix(turned, bounds);
    const yawRad = (30 * Math.PI) / 180;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
          // Back into the box's own axes (positive yaw turns left, as three.js rotation.y).
          const dx = p.x - turned.xM;
          const dz = p.z - turned.zM;
          const localX = dx * Math.cos(yawRad) - dz * Math.sin(yawRad);
          const localZ = dx * Math.sin(yawRad) + dz * Math.cos(yawRad);
          expect(Math.abs(localX)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(localZ)).toBeLessThanOrEqual(0.25 + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(-1e-9);
          expect(p.y).toBeLessThanOrEqual(1 + 1e-9);
        }
  });

  it('"fit box to model" shrinks the box to the fitted model, never below the smallest size', () => {
    expect(boxSizeFittedToModel(bench, bounds, 0, 0.1)).toEqual({ widthM: 1, depthM: 0.25, heightM: 0.5 });
    const flat = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 1)); // a decal
    expect(fitScale(bench, flat)).toBeCloseTo(1);
    expect(boxSizeFittedToModel(bench, flat, 0, 0.1).heightM).toBe(0.1);
  });
});

describe('repeating a model along its box (5.5b Part 2)', () => {
  /** A Lab Assets counter unit: 0.62 wide, 0.70 tall, 0.76 deep. */
  const unit = new THREE.Box3(new THREE.Vector3(-0.31, 0, -0.38), new THREE.Vector3(0.31, 0.7, 0.38));
  const longBench: RoomBox = { kind: 'prop', xM: 2, zM: -1, widthM: 4, depthM: 1, heightM: 1 };

  /** Every corner of every copy, in the box's own axes (its centre and base at 0). */
  function cornersInBox(box: RoomBox, matrices: THREE.Matrix4[]): THREE.Vector3[] {
    const yawRad = ((box.yawDeg ?? 0) * Math.PI) / 180;
    const corners: THREE.Vector3[] = [];
    for (const matrix of matrices)
      for (const x of [unit.min.x, unit.max.x])
        for (const y of [unit.min.y, unit.max.y])
          for (const z of [unit.min.z, unit.max.z]) {
            const p = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
            const dx = p.x - box.xM;
            const dz = p.z - box.zM;
            corners.push(new THREE.Vector3(dx * Math.cos(yawRad) - dz * Math.sin(yawRad), p.y - (box.yM ?? 0), dx * Math.sin(yawRad) + dz * Math.cos(yawRad)));
          }
    return corners;
  }

  it('a 4 m bench shows five counter units filling its length exactly, none bigger than the bench', () => {
    const matrices = modelMatrices(longBench, unit, 0, 'repeat');
    expect(matrices).toHaveLength(5);
    const corners = cornersInBox(longBench, matrices);
    expect(Math.min(...corners.map((c) => c.x))).toBeCloseTo(-2);
    expect(Math.max(...corners.map((c) => c.x))).toBeCloseTo(2);
    for (const c of corners) {
      expect(Math.abs(c.z)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('follows a turned box, and a desk that runs along z with the unit turned a quarter', () => {
    const turned = { ...longBench, yawDeg: 30 };
    for (const c of cornersInBox(turned, modelMatrices(turned, unit, 0, 'repeat'))) {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(c.z)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    const desk: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 0.8, depthM: 2.4, heightM: 1.1 };
    // Turned a quarter, the unit's 0.76 m depth lies across the 0.8 m desk (scale 1.05), so each copy is 0.65 m along it: 4 copies.
    expect(modelMatrices(desk, unit, 90, 'repeat')).toHaveLength(4);
  });

  it('stacks up a tall box, each copy standing on the one below', () => {
    const cube = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const tall: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 0.6, depthM: 0.6, heightM: 2.4, yM: 1 };
    const bases = modelMatrices(tall, cube, 0, 'repeat').map((matrix) => new THREE.Vector3(0, 0, 0).applyMatrix4(matrix).y);
    expect(bases.map((y) => +y.toFixed(3))).toEqual([1, 1.6, 2.2, 2.8]);
  });

  it('"even" (or no fit) is one copy; repeat adds instances, not draw calls', () => {
    expect(modelMatrices(longBench, unit)).toHaveLength(1);
    const model = flattenModel(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.76), new THREE.MeshStandardMaterial()));
    const box = { ...longBench, id: 'bench', label: 'bench', kind: 'prop' as const, model: 'kit:a/b.glb', modelFit: 'repeat' as const };
    const meshes = drawBoxModels([box], new Map([['kit:a/b.glb', model]]));
    expect(meshes).toHaveLength(1);
    expect(meshes[0].count).toBe(5);
  });

  it('"fit box to model" on a repeating box keeps its length and shrinks the other sides to the row', () => {
    const size = boxSizeFittedToModel(longBench, unit, 0, 0.1, 'repeat');
    expect(size.widthM).toBeCloseTo(4);
    expect(size.depthM).toBeCloseTo(0.76 * (4 / (5 * 0.62)));
    expect(size.heightM).toBeCloseTo(0.7 * (4 / (5 * 0.62)));
  });

  it('the format writes "repeat" and leaves an even fit out', () => {
    const file = {
      formatVersion: 6,
      name: 'repeat',
      floor: { widthM: 10, depthM: 10, surfaces: [], hazards: [] },
      start: { id: 'start', xM: 0, zM: 0, yawDeg: 0 },
      dummies: [],
      spawns: [],
      boxes: [{ id: 'bench', label: 'bench', kind: 'prop', xM: 1, zM: 1, widthM: 4, depthM: 1, heightM: 1, model: 'prop-counter', modelFit: 'repeat' }],
      coverAdd: [],
      coverRemove: [],
      acousticZones: [],
      speakers: [],
      arrivals: [],
    };
    expect(checkLevel(JSON.parse(levelToJson(checkLevel(file)))).boxes[0].modelFit).toBe('repeat');
    expect(() => checkLevel({ ...file, boxes: [{ ...file.boxes[0], modelFit: 'stretch' }] })).toThrow(LevelError);
  });
});

describe('loaded models', () => {
  it('drops morph targets, which an instanced mesh cannot draw (it stopped the game: the Lab Assets extinguisher)', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.morphAttributes.position = [geometry.getAttribute('position').clone()];
    const root = new THREE.Group();
    const part = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    part.position.set(0, 0.5, 0);
    root.add(part);
    const model = flattenModel(root);
    expect(Object.keys(model.parts[0].geometry.morphAttributes)).toEqual([]);
    expect(model.bounds.min.y).toBeCloseTo(0); // moved into the model's own space
    const box = { ...bench, id: 'bench', label: 'bench', kind: 'prop' as const, model: 'kit:a/b.glb' };
    const [mesh] = drawBoxModels([box], new Map([['kit:a/b.glb', model]]));
    expect(Object.keys(mesh.geometry.morphAttributes)).toEqual([]);
    expect(mesh.morphTargetInfluences).toBeUndefined();
  });
});

describe('freeing a model drawn only for its picture (the asset browser, 5.2d)', () => {
  it('frees its geometry, its materials and their textures', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const model = flattenModel(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    const freed: string[] = [];
    model.parts[0].geometry.addEventListener('dispose', () => freed.push('geometry'));
    material.addEventListener('dispose', () => freed.push('material'));
    texture.addEventListener('dispose', () => freed.push('texture'));
    disposeModel(model);
    expect(freed.sort()).toEqual(['geometry', 'material', 'texture']);
  });
});

describe('the format (version 5)', () => {
  const level = (box: Record<string, unknown>) => ({
    formatVersion: 5,
    name: 'models',
    floor: { widthM: 10, depthM: 10, surfaces: [], hazards: [] },
    start: { id: 'start', xM: 0, zM: 0, yawDeg: 0 },
    dummies: [],
    spawns: [],
    boxes: [{ id: 'bench', label: 'bench', kind: 'prop', xM: 1, zM: 1, widthM: 1, depthM: 1, heightM: 1, ...box }],
    coverAdd: [],
    coverRemove: [],
    acousticZones: [],
    speakers: [],
    arrivals: [],
  });
  const problems = (box: Record<string, unknown>) => {
    try {
      checkLevel(level(box));
      return [];
    } catch (error) {
      return (error as LevelError).problems;
    }
  };

  it('reads and writes a model and its turn, and leaves a turn of 0 out', () => {
    const checked = checkLevel(level({ model: 'kit:Kenney Space/Models/GLB format/desk.glb', modelYawDeg: 90 }));
    expect(checked.boxes[0]).toMatchObject({ model: 'kit:Kenney Space/Models/GLB format/desk.glb', modelYawDeg: 90 });
    expect(checkLevel(JSON.parse(levelToJson(checked))).boxes[0].modelYawDeg).toBe(90);
    expect('modelYawDeg' in checkLevel(level({ model: 'prop-bench', modelYawDeg: 0 })).boxes[0]).toBe(false);
  });

  it('refuses a model name that is neither a game model nor a kit file, and a turn that is not a quarter', () => {
    expect(problems({ model: 'Bench.glb' })).toHaveLength(1);
    expect(problems({ model: 'kit:' })).toHaveLength(1);
    expect(problems({ model: 'prop-bench', modelYawDeg: 45 })).toEqual(['boxes[0].modelYawDeg must be one of 0, 90, 180, 270']);
  });
});

describe('the committed level files', () => {
  const levelFiles = import.meta.glob<unknown>('../src/data/levels/*.json', { eager: true, import: 'default' });
  const gameModels = import.meta.glob<string>('../src/assets/models/*.glb', { eager: true, query: '?url', import: 'default' });
  it('there are level files to check', () => expect(Object.keys(levelFiles).length).toBeGreaterThan(0));
  for (const [file, raw] of Object.entries(levelFiles)) {
    it(`${file} only uses game models that exist (a kit being tried must not be committed)`, () => {
      for (const box of checkLevel(raw).boxes) {
        if (box.model === undefined) continue;
        expect(isKitModel(box.model), `${box.id} uses a kit file: ${box.model}`).toBe(false);
        expect(gameModelPattern.test(box.model)).toBe(true);
        expect(`../src/assets/models/${box.model}.glb` in gameModels, `${box.id}: src/assets/models/${box.model}.glb is missing`).toBe(true);
      }
    });
  }
});
