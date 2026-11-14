import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { greyboxFloors, greyboxHazards, greyboxRoom, greyboxRoomSize, isClimbable, type RoomBox } from '../data/greyboxRoom';
import { LevelCollision } from './collision';

export interface GreyboxLevel {
  /** Everything to draw. */
  group: THREE.Group;
  /** The same boxes as collision, so what you see is what you bump into. */
  collision: LevelCollision;
}

const shades = { wall: 0x4a4f55, prop: 0x8a9097, marker: 0xff7a1a, floor: 0x2b2f33 } as const;

function boxGeometry(box: RoomBox): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(box.widthM, box.heightM, box.depthM);
  geometry.translate(box.xM, (box.yM ?? 0) + box.heightM / 2, box.zM);
  return geometry;
}

export function buildGreybox(boxes: readonly RoomBox[] = greyboxRoom): GreyboxLevel {
  const group = new THREE.Group();
  const geometries = boxes.map(boxGeometry);

  boxes.forEach((box, index) => {
    group.add(new THREE.Mesh(geometries[index], new THREE.MeshStandardMaterial({ color: shades[box.kind] })));
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(greyboxRoomSize.widthM, greyboxRoomSize.depthM).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: shades.floor }),
  );
  group.add(floor);

  // The floor patches with their own surface (footsteps): drawn in slightly different tints so they can be told apart.
  const surfaceTints = { concrete: shades.floor, metal: 0x263340, tile: 0x4a5258 } as const;
  for (const zone of greyboxFloors) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.widthM, zone.depthM).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: surfaceTints[zone.surface], polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
    );
    mesh.position.set(zone.xM, 0.003, zone.zM);
    group.add(mesh);
  }

  // The test hazard pads: flat red squares on the floor.
  for (const pad of greyboxHazards) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pad.widthM, pad.depthM).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc41e1e, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    mesh.position.set(pad.xM, 0.005, pad.zM);
    group.add(mesh);
  }

  // A grid helps the eye judge movement. 0.01 m up so it does not flicker against the floor.
  const grid = new THREE.GridHelper(greyboxRoomSize.widthM, greyboxRoomSize.widthM, 0x55606b, 0x3a424a);
  grid.position.y = 0.01;
  group.add(grid);

  // Collision gets everything; a second copy of just the climbable boxes tells the ledge check what Space may climb.
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('Could not merge the room geometry for collision');
  const climbableBoxes = boxes.filter(isClimbable);
  const climbable = climbableBoxes.length > 0 ? mergeGeometries(climbableBoxes.map(boxGeometry), false) : null;
  return { group, collision: new LevelCollision(merged, climbable) };
}
