import * as THREE from 'three';
import { dummyConfig } from '../config/dummy';
import { standInConfig } from '../config/standInEnemy';
import type { StandInEnemy } from './standInEnemy';

const bodyColour = 0x4b5a3a; // dark olive, so it is not mistaken for a dummy
const headColour = 0x9aa3a8; // lighter than the body, so the head is easy to aim at
const gunColour = 0x15171a;
const gunSizeM = { width: 0.08, height: 0.1, length: 0.6 } as const;

// The drawn stand-in: the dummy's box body and sphere head with a gun block, pivoting at its feet so it can tip over.
// It follows the enemy's position and facing every update.
export class StandInView {
  readonly group = new THREE.Group();

  constructor(private readonly enemy: StandInEnemy) {
    const { heightM, bodyWidthM, bodyDepthM, headRadiusM } = dummyConfig;
    const bodyHeightM = heightM - 2 * headRadiusM;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWidthM, bodyHeightM, bodyDepthM),
      new THREE.MeshStandardMaterial({ color: bodyColour }),
    );
    body.position.y = bodyHeightM / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headRadiusM, 16, 12), new THREE.MeshStandardMaterial({ color: headColour }));
    head.position.y = bodyHeightM + headRadiusM;
    // The gun points forward (-z in its own space) and ends at the muzzle.
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(gunSizeM.width, gunSizeM.height, gunSizeM.length),
      new THREE.MeshStandardMaterial({ color: gunColour }),
    );
    gun.position.set(0, standInConfig.muzzleHeightM, -(standInConfig.muzzleForwardM - gunSizeM.length / 2));
    this.group.add(body, head, gun);
    this.group.rotation.order = 'YXZ'; // turn to face first, then tip over relative to that facing
  }

  /** Called every update. */
  update(): void {
    this.group.position.set(this.enemy.xM, 0, this.enemy.zM);
    this.group.rotation.y = this.enemy.yawRad;
    this.group.rotation.x = (Math.PI / 2) * this.enemy.fallProgress; // tips over backwards
  }
}
