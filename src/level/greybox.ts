import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { greyboxLayout, greyboxRoom, isClimbable, type RoomBox, type RoomLayout } from '../data/greyboxRoom';
import { defaultMaterial, floorMaterial, materialDef } from '../data/materials';
import { LevelCollision } from './collision';
import { GlassPanes, standsOnFloor, type GlassPane } from './glass';

export interface GreyboxLevel {
  /** Everything to draw. */
  group: THREE.Group;
  /** The meshes the boxes are drawn with, one per look (the edit mode hides them while it draws its own, 5.2). */
  boxMeshes: THREE.Mesh[];
  /** The same boxes as collision, so what you see is what you bump into. */
  collision: LevelCollision;
  /** Every box plus the floor, as one set of triangles: what the navigation mesh is built from (4.2). */
  navigationGeometry: THREE.BufferGeometry;
  /** The breakable glass (5.4): the panes and what each has taken. Walking is blocked by the panes still whole (`collision`), rays pass them. */
  glass: GlassPanes;
  /** The mesh of each pane, by its id: hidden when it breaks. They are also in `boxMeshes`. */
  glassMeshes: Map<string, THREE.Mesh>;
  /** The panes still whole, as triangles for `collision.setGlass`; null if none is left. */
  glassGeometry: () => THREE.BufferGeometry | null;
  /** The panes that stand on the floor: a broken one is a gap to walk through, so the navigation mesh follows them (5.4). */
  floorGlass: GlassPane[];
  /** `navigationGeometry` without the floor-standing panes, for a navigation mesh that opens them when they break. The same geometry if there are none. */
  navigationGeometryWithoutFloorGlass: THREE.BufferGeometry;
}

const shades = { wall: 0x4a4f55, prop: 0x8a9097, marker: 0xff7a1a, floor: 0x2b2f33, glass: 0x7fc8e8 } as const;

/**
 * A box's triangles, in place (turned by its `yawDeg`, 5.5a). A ramp is the box with the top edge at its low end brought down to the bottom, so its top
 * slopes up toward the side it names (north is -z).
 */
export function boxGeometry(box: RoomBox): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(box.widthM, box.heightM, box.depthM);
  uvsInMetres(geometry, box);
  if (box.ramp) {
    const position = geometry.getAttribute('position');
    const lowEnd = { north: (_x: number, z: number) => z > 0, south: (_x: number, z: number) => z < 0, east: (x: number) => x < 0, west: (x: number) => x > 0 }[box.ramp];
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > 0 && lowEnd(position.getX(i), position.getZ(i))) position.setY(i, -box.heightM / 2);
    }
    geometry.computeVertexNormals(); // each face has its own corners, so the normals stay flat per face
  }
  if (box.yawDeg) geometry.rotateY((box.yawDeg * Math.PI) / 180); // turned about its own centre (5.5a)
  geometry.translate(box.xM, (box.yM ?? 0) + box.heightM / 2, box.zM);
  return geometry;
}

/**
 * A box's faces in the order three.js builds them (+x, -x, +y, -y, +z, -z), with each face's size in metres across and
 * up its picture. Materials repeat at real size because a face's picture coordinates are in metres (5.5c).
 */
export function faceSizesM(box: RoomBox): [number, number][] {
  const { widthM: w, heightM: h, depthM: d } = box;
  return [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
}
/** The face a piece of equipment shows its front on: -z, the way it faces when not turned (5.5c). */
export const frontFace = 5;
/**
 * The face that carries an equipment front, by the box's `modelYawDeg` (the same "turn inside the box" as a model's):
 * 0 faces -z, 90 turns left to -x, 180 faces +z, 270 faces +x.
 */
const frontFaceByTurn: Record<number, number> = { 0: frontFace, 90: 1, 180: 4, 270: 0 };
const verticesPerFace = 4;

/** Turns a box geometry's picture coordinates (0 to 1 on each face) into metres. */
function uvsInMetres(geometry: THREE.BufferGeometry, box: RoomBox): void {
  const uv = geometry.getAttribute('uv');
  faceSizesM(box).forEach(([across, up], face) => {
    for (let i = face * verticesPerFace; i < (face + 1) * verticesPerFace; i++) uv.setXY(i, uv.getX(i) * across, uv.getY(i) * up);
  });
}

/** Some of a box geometry's faces only (by three.js's face order), sharing nothing with the original. */
function facesOf(geometry: THREE.BufferGeometry, faces: readonly number[]): THREE.BufferGeometry {
  const part = geometry.clone();
  const index = geometry.getIndex()!;
  const kept: number[] = [];
  for (const face of faces) {
    const group = geometry.groups[face];
    for (let i = group.start; i < group.start + group.count; i++) kept.push(index.getX(i));
  }
  part.setIndex(kept);
  part.clearGroups();
  return part;
}

/** What each part of a box is drawn with: its material on every face, or for an equipment front, the front on its front face and the rest elsewhere. */
export function boxPieces(box: RoomBox & { modelYawDeg?: number }): { material: string; geometry: THREE.BufferGeometry }[] {
  const geometry = boxGeometry(box);
  const name = box.material ?? defaultMaterial(box.kind);
  const front = materialDef(name)?.front;
  if (!front) return [{ material: name, geometry }];
  const face = frontFaceByTurn[box.modelYawDeg ?? 0] ?? frontFace;
  const sides = [0, 1, 2, 3, 4, 5].filter((other) => other !== face);
  return [
    { material: name, geometry: facesOf(geometry, [face]) },
    { material: front.rest, geometry: facesOf(geometry, sides) },
  ];
}

/** Gives the drawn material for a name from src/data/materials.ts (the game's textured ones, src/level/materials.ts). */
export type MaterialFor = (name: string) => THREE.Material;

/** A flat piece of floor, its picture coordinates in metres so floor materials repeat at real size. */
function floorPlane(widthM: number, depthM: number): THREE.BufferGeometry {
  const plane = new THREE.PlaneGeometry(widthM, depthM).rotateX(-Math.PI / 2);
  const uv = plane.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * widthM, uv.getY(i) * depthM);
  return plane;
}

/** Whether a box is drawn, and whether it collides (and is on the navigation mesh): both unless the level says not. */
const isDrawn = (box: RoomBox) => box.drawn !== false;
const isSolid = (box: RoomBox) => box.solid !== false;

/**
 * `modelled`: boxes drawn as a model instead (5.5b, src/level/models.ts); they still collide and stay on the navigation mesh.
 * `materialFor` (5.5c): draw with the lab's materials, merged per material; left out, every box is drawn in its kind's flat
 * grey as before (the tests and the editor's reach check need no pictures).
 */
export function buildGreybox(boxes: readonly RoomBox[] = greyboxRoom, layout: RoomLayout = greyboxLayout, modelled: ReadonlySet<RoomBox> = new Set(), materialFor?: MaterialFor): GreyboxLevel {
  const { size, floors, hazards } = layout;
  const group = new THREE.Group();

  // One mesh per look (a material, or with no materials a kind) with its boxes merged, so the room costs a few draw calls
  // instead of one per box (the chamber has about 190 boxes, 5.3). The edit mode hides these while it draws its own copy (5.2).
  const boxMeshes: THREE.Mesh[] = [];
  const looks = new Map<string, THREE.BufferGeometry[]>();
  const glass = new GlassPanes(boxes);
  const glassMeshes = new Map<string, THREE.Mesh>();
  const glassMaterial = new THREE.MeshStandardMaterial({ color: shades.glass, transparent: true, opacity: 0.35, depthWrite: false }); // see-through
  for (const box of boxes) {
    if (!isDrawn(box)) continue; // a stair's ramp: walked on, not seen
    if (box.glass) continue; // glass is drawn pane by pane below, so a broken one can disappear
    if (modelled.has(box)) continue;
    const pieces = materialFor && box.kind !== 'marker' ? boxPieces(box) : [{ material: box.kind, geometry: boxGeometry(box) }];
    for (const piece of pieces) looks.set(piece.material, [...(looks.get(piece.material) ?? []), piece.geometry]);
  }
  for (const [look, parts] of looks) {
    const geometry = mergeGeometries(parts, false);
    if (!geometry) throw new Error(`Could not merge the room's ${look} boxes for drawing`);
    const flat = look === 'wall' || look === 'prop' || look === 'marker';
    const material = flat || !materialFor ? new THREE.MeshStandardMaterial({ color: shades[look as RoomBox['kind']] }) : materialFor(look);
    const mesh = new THREE.Mesh(geometry, material);
    boxMeshes.push(mesh);
    group.add(mesh);
  }
  for (const pane of glass.panes) {
    const mesh = new THREE.Mesh(boxGeometry(pane.box), glassMaterial);
    glassMeshes.set(pane.id, mesh);
    boxMeshes.push(mesh);
    group.add(mesh);
  }

  const floor = new THREE.Mesh(
    floorPlane(size.widthM, size.depthM),
    materialFor ? materialFor(floorMaterial.bare) : new THREE.MeshStandardMaterial({ color: shades.floor }),
  );
  group.add(floor);

  // The floor patches with their own surface (footsteps): drawn in slightly different tints, or with materials their
  // surface's look, so they can be told apart. Each gets its own copy of the material, pulled toward the eye so it never
  // flickers against the floor (the textures are shared).
  const surfaceTints = { concrete: shades.floor, metal: 0x263340, tile: 0x4a5258 } as const;
  for (const zone of floors) {
    const patch = materialFor ? materialFor(floorMaterial[zone.surface]).clone() : new THREE.MeshStandardMaterial({ color: surfaceTints[zone.surface] });
    Object.assign(patch, { polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
    const mesh = new THREE.Mesh(floorPlane(zone.widthM, zone.depthM), patch);
    mesh.position.set(zone.xM, 0.003, zone.zM);
    group.add(mesh);
  }

  // The test hazard pads: flat red squares on the floor.
  for (const pad of hazards) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pad.widthM, pad.depthM).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc41e1e, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    mesh.position.set(pad.xM, 0.005, pad.zM);
    group.add(mesh);
  }

  // In grey box, a grid helps the eye judge movement (0.01 m up so it does not flicker); the floor tiles do that with materials.
  if (!materialFor) {
    const gridM = Math.max(size.widthM, size.depthM);
    const grid = new THREE.GridHelper(gridM, gridM, 0x55606b, 0x3a424a);
    grid.position.y = 0.01;
    group.add(grid);
  }

  // Collision gets every solid box (not a stair's drawn steps, and not glass: that has its own, 5.4); a second copy of just
  // the climbable boxes tells the ledge check what Space may climb (never glass).
  const solidBoxes = boxes.filter(isSolid);
  const hardBoxes = solidBoxes.filter((box) => !box.glass);
  const merged = mergeGeometries(hardBoxes.map(boxGeometry), false);
  if (!merged) throw new Error('Could not merge the room geometry for collision');
  const climbableBoxes = hardBoxes.filter(isClimbable);
  const climbable = climbableBoxes.length > 0 ? mergeGeometries(climbableBoxes.map(boxGeometry), false) : null;
  // The navigation mesh needs the floor too (collision treats height 0 as the floor instead).
  const floorGeometry = new THREE.PlaneGeometry(size.widthM, size.depthM).rotateX(-Math.PI / 2);
  const navigationGeometry = mergeGeometries([...solidBoxes.map(boxGeometry), floorGeometry], false);
  if (!navigationGeometry) throw new Error('Could not merge the room geometry for navigation');
  const floorGlass = glass.panes.filter(standsOnFloor);
  const withoutFloorGlass = floorGlass.length === 0 ? navigationGeometry : mergeGeometries([...solidBoxes.filter((box) => !floorGlass.some((pane) => pane.box === box)).map(boxGeometry), floorGeometry.clone()], false);
  if (!withoutFloorGlass) throw new Error('Could not merge the room geometry for navigation');
  const glassGeometry = () => {
    const whole = glass.intactBoxes();
    return whole.length === 0 ? null : mergeGeometries(whole.map(boxGeometry), false);
  };
  const collision = new LevelCollision(merged, climbable);
  collision.setGlass(glassGeometry());
  return { group, boxMeshes, collision, navigationGeometry, glass, glassMeshes, glassGeometry, floorGlass, navigationGeometryWithoutFloorGlass: withoutFloorGlass };
}
