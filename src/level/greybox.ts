import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { greyboxLayout, greyboxRoom, isClimbable, type RoomBox, type RoomLayout } from '../data/greyboxRoom';
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

/** Whether a box is drawn, and whether it collides (and is on the navigation mesh): both unless the level says not. */
const isDrawn = (box: RoomBox) => box.drawn !== false;
const isSolid = (box: RoomBox) => box.solid !== false;

export function buildGreybox(boxes: readonly RoomBox[] = greyboxRoom, layout: RoomLayout = greyboxLayout): GreyboxLevel {
  const { size, floors, hazards } = layout;
  const group = new THREE.Group();
  const geometries = boxes.map(boxGeometry);

  // One mesh per look (walls, props, markers, glass) with its boxes merged, so the room costs a few draw calls instead of
  // one per box (the chamber has about 190 boxes, 5.3). The edit mode hides these while it draws its own copy (5.2).
  const boxMeshes: THREE.Mesh[] = [];
  const looks = new Map<string, THREE.BufferGeometry[]>();
  const glass = new GlassPanes(boxes);
  const glassMeshes = new Map<string, THREE.Mesh>();
  const glassMaterial = new THREE.MeshStandardMaterial({ color: shades.glass, transparent: true, opacity: 0.35, depthWrite: false }); // see-through
  boxes.forEach((box, index) => {
    if (!isDrawn(box)) return; // a stair's ramp: walked on, not seen
    if (box.glass) return; // glass is drawn pane by pane below, so a broken one can disappear
    looks.set(box.kind, [...(looks.get(box.kind) ?? []), geometries[index]]);
  });
  for (const [look, parts] of looks) {
    const geometry = mergeGeometries(parts, false);
    if (!geometry) throw new Error(`Could not merge the room's ${look} boxes for drawing`);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: shades[look as RoomBox['kind']] }));
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
    new THREE.PlaneGeometry(size.widthM, size.depthM).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: shades.floor }),
  );
  group.add(floor);

  // The floor patches with their own surface (footsteps): drawn in slightly different tints so they can be told apart.
  const surfaceTints = { concrete: shades.floor, metal: 0x263340, tile: 0x4a5258 } as const;
  for (const zone of floors) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.widthM, zone.depthM).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: surfaceTints[zone.surface], polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
    );
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

  // A grid helps the eye judge movement. 0.01 m up so it does not flicker against the floor.
  const gridM = Math.max(size.widthM, size.depthM);
  const grid = new THREE.GridHelper(gridM, gridM, 0x55606b, 0x3a424a);
  grid.position.y = 0.01;
  group.add(grid);

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
