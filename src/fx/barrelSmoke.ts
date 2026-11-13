import * as THREE from 'three';
import { rifleConfig } from '../config/rifle';
import { viewmodelConfig as config } from '../config/viewmodel';
import { heatMax } from '../weapons/jam';

const poolSize = 14;
const smokeColour = 0xb8bcc2;
const spreadM = 0.01; // each puff starts a little off the muzzle, so they do not stack

interface Puff {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  ageSec: number;
  active: boolean;
}

// Smoke from a hot rifle barrel (weapons.md: from 50 heat). Puffs are born at the muzzle, then stay in the world, rising,
// growing and fading. More of them as the barrel gets hotter. Pooled: nothing is created while shooting.
export class BarrelSmoke {
  private readonly pool: Puff[] = [];
  private nextIndex = 0;
  private timerSec = 0;
  private readonly position = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    /** The rifle's muzzle in camera space, kept up to date by the viewmodel. */
    private readonly muzzle: THREE.Vector3,
  ) {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < poolSize; i++) {
      const material = new THREE.MeshBasicMaterial({ color: smokeColour, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, material, ageSec: 0, active: false });
    }
  }

  /** Removes every puff (instant restart). */
  clear(): void {
    for (const puff of this.pool) {
      puff.active = false;
      puff.mesh.visible = false;
    }
    this.timerSec = 0;
  }

  /** `smoking` is true while the rifle is the weapon in hand; `heat` is its heat, 0 to 100. */
  update(dtSec: number, heat: number, smoking: boolean): void {
    if (smoking && heat >= rifleConfig.heatSmokeStart) {
      const hotness = Math.min((heat - rifleConfig.heatSmokeStart) / Math.max(heatMax - rifleConfig.heatSmokeStart, 1), 1);
      const everySec = config.smokeEverySecAtStart + (config.smokeEverySecAtMaxHeat - config.smokeEverySecAtStart) * hotness;
      this.timerSec += dtSec;
      if (this.timerSec >= everySec) {
        this.timerSec = 0;
        this.spawn();
      }
    } else {
      this.timerSec = 0;
    }

    for (const puff of this.pool) {
      if (!puff.active) continue;
      puff.ageSec += dtSec;
      const life = puff.ageSec / Math.max(config.smokeLifeSec, 0.05);
      if (life >= 1) {
        puff.active = false;
        puff.mesh.visible = false;
        continue;
      }
      puff.mesh.position.y += config.smokeRiseMps * dtSec;
      puff.mesh.scale.setScalar(config.smokeSizeM * (1 + (config.smokeGrowth - 1) * life));
      puff.material.opacity = config.smokeOpacity * (1 - life);
    }
  }

  private spawn(): void {
    const puff = this.pool[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % poolSize;
    this.camera.updateMatrixWorld();
    this.position.copy(this.muzzle);
    this.camera.localToWorld(this.position);
    puff.mesh.position.set(
      this.position.x + (Math.random() - 0.5) * spreadM,
      this.position.y + (Math.random() - 0.5) * spreadM,
      this.position.z + (Math.random() - 0.5) * spreadM,
    );
    puff.mesh.scale.setScalar(config.smokeSizeM);
    puff.material.opacity = config.smokeOpacity;
    puff.mesh.visible = true;
    puff.ageSec = 0;
    puff.active = true;
  }
}
