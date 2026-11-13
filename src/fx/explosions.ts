import * as THREE from 'three';
import type { EventBus } from '../core/events';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { WeaponEvents } from '../weapons/events';

const poolSize = 4;
const scorchCount = 8; // the oldest scorch mark is reused
const flashSec = 0.2;
const smokeSec = 1.8;
const flashColour = 0xffa23a;
const smokeColour = 0x55585c;
const scorchColour = 0x0c0c0c;
const flashRadiusShare = 0.45; // of the blast radius
const smokeRadiusShare = 0.35;
const smokeRiseM = 1.2;
const scorchRadiusM = 0.9;
const scorchLiftM = 0.012;
const scorchSearchM = 1.5; // looks this far down for a surface to burn
const forward = new THREE.Vector3(0, 0, 1);

interface Blast {
  flash: THREE.Mesh;
  smoke: THREE.Mesh;
  ageSec: number;
  active: boolean;
}

// What a grenade blast looks like: a bright flash, a smoke ball that rises and fades, and a scorch mark on the surface
// below. Pooled: nothing is created when one goes off. Cosmetic only; the damage is worked out by the grenade system.
export class Explosions {
  private readonly blasts: Blast[] = [];
  private readonly scorches: THREE.Mesh[] = [];
  private nextBlast = 0;
  private nextScorch = 0;
  private readonly hit = createRayHit();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly from = new THREE.Vector3();
  private radiusM = 1;

  constructor(
    scene: THREE.Scene,
    events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
  ) {
    const sphere = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < poolSize; i++) {
      const flash = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: flashColour, transparent: true, depthWrite: false }));
      const smoke = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: smokeColour, transparent: true, depthWrite: false }));
      flash.visible = false;
      smoke.visible = false;
      scene.add(flash, smoke);
      this.blasts.push({ flash, smoke, ageSec: 0, active: false });
    }
    const disc = new THREE.CircleGeometry(scorchRadiusM, 16);
    const scorchMaterial = new THREE.MeshBasicMaterial({
      color: scorchColour,
      transparent: true,
      opacity: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    for (let i = 0; i < scorchCount; i++) {
      const mark = new THREE.Mesh(disc, scorchMaterial);
      mark.visible = false;
      scene.add(mark);
      this.scorches.push(mark);
    }
    events.on('grenade:exploded', ({ position, radiusM }) => this.explode(position, radiusM));
  }

  private explode(position: THREE.Vector3, radiusM: number): void {
    this.radiusM = radiusM;
    const blast = this.blasts[this.nextBlast];
    this.nextBlast = (this.nextBlast + 1) % poolSize;
    blast.flash.position.copy(position);
    blast.smoke.position.copy(position);
    blast.flash.visible = true;
    blast.smoke.visible = true;
    blast.ageSec = 0;
    blast.active = true;
    this.burnSurface(position);
  }

  /** A dark mark on the surface below the blast, if there is one close by. */
  private burnSurface(position: THREE.Vector3): void {
    this.from.copy(position);
    this.from.y += 0.3;
    if (!this.collision.raycast(this.from, this.down, scorchSearchM, this.hit)) return;
    const mark = this.scorches[this.nextScorch];
    this.nextScorch = (this.nextScorch + 1) % scorchCount;
    mark.position.copy(this.hit.normal).multiplyScalar(scorchLiftM).add(this.hit.point);
    mark.quaternion.setFromUnitVectors(forward, this.hit.normal);
    mark.visible = true;
  }

  update(dtSec: number): void {
    for (const blast of this.blasts) {
      if (!blast.active) continue;
      blast.ageSec += dtSec;
      const flash = blast.ageSec / flashSec;
      const smoke = blast.ageSec / smokeSec;
      if (smoke >= 1) {
        blast.active = false;
        blast.flash.visible = false;
        blast.smoke.visible = false;
        continue;
      }
      blast.flash.visible = flash < 1;
      if (flash < 1) {
        blast.flash.scale.setScalar(this.radiusM * flashRadiusShare * (0.3 + 0.7 * flash));
        (blast.flash.material as THREE.MeshBasicMaterial).opacity = 1 - flash;
      }
      blast.smoke.scale.setScalar(this.radiusM * smokeRadiusShare * (0.4 + 0.6 * Math.min(smoke * 3, 1)));
      blast.smoke.position.y += (smokeRiseM / smokeSec) * dtSec;
      (blast.smoke.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - smoke);
    }
  }
}
