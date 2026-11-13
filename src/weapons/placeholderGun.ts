import * as THREE from 'three';
import type { GunId, WeaponId } from './events';

// Plain blocks standing in for the weapons until the real viewmodels (milestone 2.5). They are children of the camera,
// so they follow the view, and they are drawn on top of walls so they never sink into them.
interface BlockSpec {
  sizeM: { x: number; y: number; z: number };
  positionM: { x: number; y: number; z: number };
  colour: number;
}

const specs: Record<WeaponId, BlockSpec> = {
  rifle: { sizeM: { x: 0.08, y: 0.12, z: 0.6 }, positionM: { x: 0.2, y: -0.2, z: -0.55 }, colour: 0x5b626a },
  pistol: { sizeM: { x: 0.06, y: 0.12, z: 0.25 }, positionM: { x: 0.18, y: -0.18, z: -0.45 }, colour: 0x3f4a55 },
  knife: { sizeM: { x: 0.02, y: 0.05, z: 0.3 }, positionM: { x: 0.2, y: -0.2, z: -0.5 }, colour: 0xb8c4cf },
};
/** Where the gun block sits when fully aimed: in the middle of the screen, a little lower than the eye line. */
const aimedPositionM = { x: 0, y: -0.13 };
const drawnLast = 999;
/** How far the knife block jabs forward, and how long that takes. */
const jabDistanceM = 0.25;
const jabTimeSec = 0.15;

export class PlaceholderViewmodels {
  /** Each gun's muzzle in camera space, for the tracers. */
  readonly muzzles: Record<GunId, THREE.Vector3>;
  private readonly blocks = {} as Record<WeaponId, THREE.Mesh>;
  private current: WeaponId = 'rifle';
  private jabSec = Infinity;

  constructor(camera: THREE.Camera) {
    for (const id of Object.keys(specs) as WeaponId[]) {
      const { sizeM, positionM, colour } = specs[id];
      const material = new THREE.MeshStandardMaterial({ color: colour, depthTest: false });
      const block = new THREE.Mesh(new THREE.BoxGeometry(sizeM.x, sizeM.y, sizeM.z), material);
      block.position.set(positionM.x, positionM.y, positionM.z);
      block.renderOrder = drawnLast;
      block.visible = id === this.current;
      camera.add(block);
      this.blocks[id] = block;
    }
    const muzzleOf = (id: GunId) => {
      const { sizeM, positionM } = specs[id];
      return new THREE.Vector3(positionM.x, positionM.y + sizeM.y / 4, positionM.z - sizeM.z / 2);
    };
    this.muzzles = { rifle: muzzleOf('rifle'), pistol: muzzleOf('pistol') };
  }

  /** Slides the gun blocks toward the middle of the screen as the aim blend goes from 0 to 1. The muzzle follows. */
  setAim(blend: number): void {
    for (const id of ['rifle', 'pistol'] as const) {
      const { sizeM, positionM } = specs[id];
      const x = positionM.x + (aimedPositionM.x - positionM.x) * blend;
      const y = positionM.y + (aimedPositionM.y - positionM.y) * blend;
      this.blocks[id].position.x = x;
      this.blocks[id].position.y = y;
      this.muzzles[id].set(x, y + sizeM.y / 4, positionM.z - sizeM.z / 2);
    }
  }

  show(weapon: WeaponId): void {
    this.blocks[this.current].visible = false;
    this.current = weapon;
    this.blocks[weapon].visible = true;
  }

  /** A quick forward jab of the knife block. */
  jab(): void {
    this.jabSec = 0;
  }

  update(dtSec: number): void {
    const knife = this.blocks.knife;
    this.jabSec += dtSec;
    const t = Math.min(this.jabSec / jabTimeSec, 1);
    knife.position.z = specs.knife.positionM.z - Math.sin(Math.PI * t) * jabDistanceM;
  }
}
