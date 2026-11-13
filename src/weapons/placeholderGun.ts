import * as THREE from 'three';

// A plain block standing in for the rifle until the real viewmodel (milestone 2.5). It is a child of the camera,
// so it follows the view, and it is drawn on top of walls so it never sinks into them.
const sizeM = { x: 0.08, y: 0.12, z: 0.6 };
const positionInCameraM = { x: 0.2, y: -0.2, z: -0.55 };
const gunColour = 0x5b626a;
const drawnLast = 999;

/** Adds the block to the camera and returns the muzzle's place in camera space. */
export function addPlaceholderGun(camera: THREE.Camera): THREE.Vector3 {
  const material = new THREE.MeshStandardMaterial({ color: gunColour, depthTest: false });
  const block = new THREE.Mesh(new THREE.BoxGeometry(sizeM.x, sizeM.y, sizeM.z), material);
  block.position.set(positionInCameraM.x, positionInCameraM.y, positionInCameraM.z);
  block.renderOrder = drawnLast;
  camera.add(block);
  return new THREE.Vector3(positionInCameraM.x, positionInCameraM.y + sizeM.y / 4, positionInCameraM.z - sizeM.z / 2);
}
