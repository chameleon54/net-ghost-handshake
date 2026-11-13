import * as THREE from 'three';
import { dummyConfig } from '../config/dummy';
import type { Dummy } from './dummy';

const bodyColour = 0x8a5a44;
const headColour = 0xd9b38c; // a different shade, so the head is easy to aim at

// The drawn dummy: a box body and a sphere head, pivoting at its feet so it can tip over.
export class DummyView {
  readonly group = new THREE.Group();

  constructor(private readonly dummy: Dummy) {
    const { heightM, bodyWidthM, bodyDepthM, headRadiusM } = dummyConfig;
    const bodyHeightM = heightM - 2 * headRadiusM;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWidthM, bodyHeightM, bodyDepthM),
      new THREE.MeshStandardMaterial({ color: bodyColour }),
    );
    body.position.y = bodyHeightM / 2;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(headRadiusM, 16, 12),
      new THREE.MeshStandardMaterial({ color: headColour }),
    );
    head.position.y = bodyHeightM + headRadiusM;
    this.group.add(body, head);
    this.group.position.set(dummy.xM, 0, dummy.zM);
  }

  /** Tip over backwards as it dies. Called every update. */
  update(): void {
    this.group.rotation.x = -(Math.PI / 2) * this.dummy.fallProgress;
  }
}
