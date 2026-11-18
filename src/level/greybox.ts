import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { greyboxLayout, greyboxRoom, isClimbable, type RoomBox, type RoomLayout } from '../data/greyboxRoom';
import { LevelCollision } from './collision';

export interface GreyboxLevel {
  /** Everything to draw. */
  group: THREE.Group;
  /** The boxes' meshes, one per box in the same order (the edit mode hides them while it draws its own, 5.2). */
  boxMeshes: THREE.Mesh[];
  /** The same boxes as collision, so what you see is what you bump into. */
  collision: LevelCollision;
  /** Every box plus the floor, as one set of triangles: what the navigation mesh is built from (4.2). */
  navigationGeometry: THREE.BufferGeometry;
}

const shades = { wall: 0x4a4f55, prop: 0x8a9097, marker: 0xff7a1a, floor: 0x2b2f33, glass: 0x7fc8e8 } as const;

function boxGeometry(box: RoomBox): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(box.widthM, box.heightM, box.depthM);
  geometry.translate(box.xM, (box.yM ?? 0) + box.heightM / 2, box.zM);
  return geometry;
}

export function buildGreybox(boxes: readonly RoomBox[] = greyboxRoom, layout: RoomLayout = greyboxLayout): GreyboxLevel {
  const { size, floors, hazards } = layout;
  const group = new THREE.Group();
  const geometries = boxes.map(boxGeometry);

  const boxMeshes: THREE.Mesh[] = [];
  boxes.forEach((box, index) => {
    const material = box.glass
      ? new THREE.MeshStandardMaterial({ color: shades.glass, transparent: true, opacity: 0.35, depthWrite: false }) // see-through (5.4 breaks it)
      : new THREE.MeshStandardMaterial({ color: shades[box.kind] });
    const mesh = new THREE.Mesh(geometries[index], material);
    boxMeshes.push(mesh);
    group.add(mesh);
  });

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

  // Collision gets everything; a second copy of just the climbable boxes tells the ledge check what Space may climb.
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('Could not merge the room geometry for collision');
  const climbableBoxes = boxes.filter(isClimbable);
  const climbable = climbableBoxes.length > 0 ? mergeGeometries(climbableBoxes.map(boxGeometry), false) : null;
  // The navigation mesh needs the floor too (collision treats height 0 as the floor instead).
  const floorGeometry = new THREE.PlaneGeometry(size.widthM, size.depthM).rotateX(-Math.PI / 2);
  const navigationGeometry = mergeGeometries([...boxes.map(boxGeometry), floorGeometry], false);
  if (!navigationGeometry) throw new Error('Could not merge the room geometry for navigation');
  return { group, boxMeshes, collision: new LevelCollision(merged, climbable), navigationGeometry };
}
