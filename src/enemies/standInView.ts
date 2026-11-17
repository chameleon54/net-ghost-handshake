import * as THREE from 'three';
import { dummyConfig } from '../config/dummy';
import type { EnemyGun } from '../config/enemyGuns';
import type { Role } from '../config/roles';
import { standInConfig } from '../config/standInEnemy';
import type { StandInEnemy } from './standInEnemy';

// Placeholder colours per role until the real models (4.13); all roles share the same shape and hit zones.
const bodyColours: Record<Role, number> = {
  trooper: 0x4b5a3a, // dark olive, so it is not mistaken for a dummy
  leader: 0x4b5a3a, // a trooper, with a red band round the head
  flanker: 0x7d93a8, // light grey-blue
  heavy: 0x1d2024, // near black
};
const headColour = 0x9aa3a8; // lighter than the body, so the head is easy to aim at
const leaderBandColour = 0xc0302a;
const bandHeightM = 0.05;
const bandWidenM = 0.01; // just outside the head, so it does not flicker against it
const gunColour = 0x15171a;
/**
 * Placeholder gun shapes (4.12, until the real model in 4.13), so the threat can be read at a glance: a short pistol, a
 * long rifle, and a long, thick machine gun with a box magazine under it.
 */
const gunShapes: Record<EnemyGun, { widthM: number; heightM: number; lengthM: number; boxMagM: number }> = {
  pistol: { widthM: 0.05, heightM: 0.12, lengthM: 0.22, boxMagM: 0 },
  rifle: { widthM: 0.07, heightM: 0.1, lengthM: 0.8, boxMagM: 0 },
  lmg: { widthM: 0.12, heightM: 0.14, lengthM: 0.95, boxMagM: 0.16 },
};

// The drawn stand-in: the dummy's box body and sphere head with its gun, pivoting at its feet so it can tip over.
// It follows the enemy's position, facing and crouch every update: crouched, the body is shorter and the head and gun
// lower, matching its hit zones. Its colour shows its role (4.8), and its gun's shape shows which gun it carries (4.12).
export class StandInView {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly gun = new THREE.Group();
  private readonly standingBodyHeightM = dummyConfig.heightM - 2 * dummyConfig.headRadiusM;

  constructor(private readonly enemy: StandInEnemy) {
    const { bodyWidthM, bodyDepthM, headRadiusM } = dummyConfig;
    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWidthM, this.standingBodyHeightM, bodyDepthM),
      new THREE.MeshStandardMaterial({ color: bodyColours[enemy.role] }),
    );
    this.head = new THREE.Mesh(new THREE.SphereGeometry(headRadiusM, 16, 12), new THREE.MeshStandardMaterial({ color: headColour }));
    if (enemy.role === 'leader') {
      const bandRadiusM = headRadiusM + bandWidenM;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(bandRadiusM, bandRadiusM, bandHeightM, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: leaderBandColour, side: THREE.DoubleSide }),
      );
      this.head.add(band); // round the head at its middle, moving with it
    }
    // The gun points forward (-z in its own space) and ends at the muzzle.
    const shape = gunShapes[enemy.gun];
    const material = new THREE.MeshStandardMaterial({ color: gunColour });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(shape.widthM, shape.heightM, shape.lengthM), material);
    barrel.position.z = -(standInConfig.muzzleForwardM - shape.lengthM / 2);
    this.gun.add(barrel);
    if (shape.boxMagM > 0) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(shape.boxMagM, shape.boxMagM, shape.boxMagM), material);
      box.position.set(0, -(shape.heightM + shape.boxMagM) / 2, barrel.position.z);
      this.gun.add(box);
    }
    this.group.add(this.body, this.head, this.gun);
    this.group.rotation.order = 'YXZ'; // turn to face first, then tip over relative to that facing
  }

  /** Called every update. */
  update(): void {
    const enemy = this.enemy;
    const bodyHeightM = enemy.heightM - 2 * dummyConfig.headRadiusM;
    this.body.scale.y = bodyHeightM / this.standingBodyHeightM;
    this.body.position.y = bodyHeightM / 2;
    this.head.position.y = bodyHeightM + dummyConfig.headRadiusM;
    this.gun.position.y = enemy.muzzleHeightNowM;
    this.group.position.set(enemy.xM, 0, enemy.zM);
    this.group.rotation.y = enemy.yawRad;
    // Tips over backwards when it falls, and a little during a flinch (decision 246).
    this.group.rotation.x = (Math.PI / 2) * enemy.fallProgress + standInConfig.flinchTiltDeg * (Math.PI / 180) * enemy.flinchShare;
  }
}
