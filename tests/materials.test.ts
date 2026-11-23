import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RoomBox } from '../src/data/greyboxRoom';
import { defaultMaterial, materialDef, materialDefs, materialNames, suggestMaterial } from '../src/data/materials';
import { boxGeometry, boxPieces, buildGreybox, faceSizesM, frontFace } from '../src/level/greybox';
import { checkLevel, LevelError, levelToJson } from '../src/level/levelData';

// The lab's materials (5.5c Part 1, decision 290): repeating at real size, a front face for equipment, drawn per material.

const wall: RoomBox = { kind: 'wall', xM: 0, zM: -5, widthM: 6, depthM: 0.3, heightM: 3 };
const rack: RoomBox = { kind: 'prop', xM: 2, zM: 0, widthM: 1.2, depthM: 1, heightM: 2, material: 'rack-front' };
const crate: RoomBox = { kind: 'prop', xM: -2, zM: 0, widthM: 1, depthM: 1, heightM: 1 };

describe('materials repeat at real size', () => {
  it("a face's picture coordinates run in metres, so a 6 m wall holds five 1.2 m panels", () => {
    const uv = boxGeometry(wall).getAttribute('uv');
    const front = (i: number) => [uv.getX(frontFace * 4 + i), uv.getY(frontFace * 4 + i)];
    const us = [0, 1, 2, 3].map((i) => front(i)[0]);
    const vs = [0, 1, 2, 3].map((i) => front(i)[1]);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(3);
    expect(6 / materialDef('lab-wall')!.tileM[0]).toBeCloseTo(5);
  });

  it('each face knows its size across and up', () => {
    expect(faceSizesM(rack)).toEqual([[1, 2], [1, 2], [1.2, 1], [1.2, 1], [1.2, 2], [1.2, 2]]);
  });
});

describe('equipment fronts', () => {
  it('a rack front goes on the front face only, metal on the other five', () => {
    const [front, rest] = boxPieces(rack);
    expect(front.material).toBe('rack-front');
    expect(rest.material).toBe('metal-panel');
    expect(front.geometry.getIndex()!.count).toBe(6); // two triangles
    expect(rest.geometry.getIndex()!.count).toBe(30);
    const normal = front.geometry.getAttribute('normal');
    const used = new Set(Array.from(front.geometry.getIndex()!.array));
    for (const i of used) expect([normal.getX(i), normal.getY(i), normal.getZ(i)].map((v) => +v.toFixed(3) + 0)).toEqual([0, 0, -1]);
  });

  it('the front turns with the box: turned to face west, it looks west (-x)', () => {
    const [front] = boxPieces({ ...rack, yawDeg: 90 });
    const normal = front.geometry.getAttribute('normal');
    const i = front.geometry.getIndex()!.getX(0);
    expect(normal.getX(i)).toBeCloseTo(-1);
    expect(normal.getZ(i)).toBeCloseTo(0);
  });

  it('"turn inside the box" moves the front to another face: 180 faces +z, 90 faces -x, 270 faces +x', () => {
    const facing = (modelYawDeg: number) => {
      const [front] = boxPieces({ ...rack, modelYawDeg });
      const normal = front.geometry.getAttribute('normal');
      const i = front.geometry.getIndex()!.getX(0);
      return [normal.getX(i), normal.getZ(i)].map((v) => Math.round(v) + 0);
    };
    expect(facing(180)).toEqual([0, 1]);
    expect(facing(90)).toEqual([-1, 0]);
    expect(facing(270)).toEqual([1, 0]);
  });

  it('a box with a plain material or none is one piece', () => {
    expect(boxPieces(crate).map((piece) => piece.material)).toEqual(['metal-panel']);
    expect(boxPieces(wall).map((piece) => piece.material)).toEqual(['lab-wall']);
    expect(boxPieces({ ...crate, material: 'hazard' }).map((piece) => piece.material)).toEqual(['hazard']);
  });
});

describe('drawing', () => {
  it('with materials, boxes are merged per material: one mesh each', () => {
    const asked: string[] = [];
    const materialFor = (name: string) => {
      asked.push(name);
      return Object.assign(new THREE.MeshBasicMaterial(), { name });
    };
    const level = buildGreybox([wall, rack, crate], { size: { widthM: 20, depthM: 20 }, floors: [{ xM: 0, zM: 0, widthM: 2, depthM: 2, surface: 'metal' }], hazards: [] }, new Set(), materialFor);
    expect(level.boxMeshes.map((mesh) => (mesh.material as THREE.Material).name).sort()).toEqual(['lab-wall', 'metal-panel', 'rack-front']);
    expect(asked).toContain('floor-tiles'); // the bare floor
    expect(asked).toContain('metal-floor'); // the metal patch
  });

  it('without materials, the old flat grey: one mesh per kind (the tests and the reach check)', () => {
    const level = buildGreybox([wall, rack, crate]);
    expect(level.boxMeshes).toHaveLength(2);
  });
});

describe('the material list', () => {
  it('names are unique, sizes positive, every front rests on a known material', () => {
    expect(new Set(materialNames).size).toBe(materialNames.length);
    for (const def of materialDefs) {
      expect(def.tileM[0]).toBeGreaterThan(0);
      expect(def.tileM[1]).toBeGreaterThan(0);
      if (def.front) expect(materialNames).toContain(def.front.rest);
    }
    expect(materialNames).toContain(defaultMaterial('wall'));
    expect(materialNames).toContain(defaultMaterial('prop'));
  });

  it('first guesses from a label for the grey equipment', () => {
    expect(suggestMaterial('server racks (bank 1)')).toBe('rack-front');
    expect(suggestMaterial('power cabinets')).toBe('rack-front');
    expect(suggestMaterial('equipment locker (ring E, cover)')).toBe('lockers-front');
    expect(suggestMaterial('specimen fridge')).toBe('fridge-front');
    expect(suggestMaterial('fume hood')).toBe('hood-front');
    expect(suggestMaterial('control console')).toBe('screen');
    expect(suggestMaterial('NE catwalk parapet')).toBe('concrete');
    expect(suggestMaterial('server core floor')).toBe('metal-floor'); // a floor, though it says "server"
    expect(suggestMaterial('rig deck')).toBe('metal-floor');
    expect(suggestMaterial('test enclosure (solid steel)')).toBeNull(); // plain metal, the default
    expect(suggestMaterial('parts crate')).toBeNull();
  });
});

describe('the format (version 7)', () => {
  const level = (box: Record<string, unknown>) => ({
    formatVersion: 7,
    name: 'materials',
    floor: { widthM: 10, depthM: 10, surfaces: [], hazards: [] },
    start: { id: 'start', xM: 0, zM: 0, yawDeg: 0 },
    dummies: [],
    spawns: [],
    boxes: [{ id: 'rack', label: 'rack', kind: 'prop', xM: 1, zM: 1, widthM: 1, depthM: 1, heightM: 2, ...box }],
    coverAdd: [],
    coverRemove: [],
    acousticZones: [],
    speakers: [],
    arrivals: [],
  });

  it('writes and reads a material; an unknown one is refused', () => {
    expect(checkLevel(JSON.parse(levelToJson(checkLevel(level({ material: 'rack-front' }))))).boxes[0].material).toBe('rack-front');
    expect(() => checkLevel(level({ material: 'gold' }))).toThrow(LevelError);
  });
});
