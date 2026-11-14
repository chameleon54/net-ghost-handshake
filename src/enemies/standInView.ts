import * as THREE from 'three';
import { dummyConfig } from '../config/dummy';
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
const gunSizeM = { width: 0.08, height: 0.1, length: 0.6 } as const;

// The drawn stand-in: the dummy's box body and sphere head with a gun block, pivoting at its feet so it can tip over.
// It follows the enemy's position, facing and crouch every update: crouched, the body is shorter and the head and gun
// lower, matching its hit zones. Its colour shows its role (4.8).
export class StandInView {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly gun: THREE.Mesh;
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
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(gunSizeM.width, gunSizeM.height, gunSizeM.length),
      new THREE.MeshStandardMaterial({ color: gunColour }),
    );
    this.gun.position.z = -(standInConfig.muzzleForwardM - gunSizeM.length / 2);
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
    this.group.rotation.x = (Math.PI / 2) * enemy.fallProgress; // tips over backwards
  }
}
