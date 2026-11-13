import * as THREE from 'three';
import { casingConfig } from '../config/casing';
import type { EventBus } from '../core/events';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { GunId, WeaponEvents } from '../weapons/events';

const poolSize = 16;
const casingLengthM = 0.03;
const casingRadiusM = 0.006;
const brassColour = 0xc9a227;
const skinM = 0.004; // a bounced casing is put this far off the surface so it does not sink in
const fadeSec = 0.5; // a casing shrinks away over its last moments
const maxSpinRadPerSec = 25;

export interface Casing {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  ageSec: number;
  resting: boolean;
  active: boolean;
}

// Spent brass: flies out of the gun, falls, bounces a little off the floor, walls and props (using the level's ray
// test), comes to rest, and shrinks away after a few seconds. Cosmetic: it never hurts or blocks anything. Pooled.
export class Casings {
  readonly pool: Casing[] = [];
  private nextIndex = 0;
  private readonly step = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly hit = createRayHit();
  private readonly start = new THREE.Vector3();
  private readonly launch = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly camera: THREE.PerspectiveCamera,
    /** Each gun's ejection port in camera space, kept up to date by the viewmodel. */
    private readonly ports: Record<GunId, THREE.Vector3>,
  ) {
    const geometry = new THREE.CylinderGeometry(casingRadiusM, casingRadiusM, casingLengthM, 8).rotateZ(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: brassColour, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < poolSize; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), ageSec: 0, resting: false, active: false });
    }
    events.on('weapon:fired', ({ weapon }) => this.eject(weapon));
  }

  /** Throws a casing out of the gun's port, to the right and up, in the direction the camera is facing. */
  private eject(weapon: GunId): void {
    this.camera.updateMatrixWorld();
    this.start.copy(this.ports[weapon]);
    this.camera.localToWorld(this.start);
    const spread = casingConfig.ejectSpreadMps;
    this.launch.set(
      casingConfig.ejectSpeedMps + (Math.random() - 0.5) * spread,
      casingConfig.ejectUpMps + (Math.random() - 0.5) * spread,
      (Math.random() - 0.3) * spread, // a little backward, toward the player
    );
    this.launch.applyQuaternion(this.camera.quaternion);
    this.spawn(this.start, this.launch);
  }

  /** Starts a casing at `position` moving at `velocity`. The oldest casing is reused if the pool is full. */
  spawn(position: THREE.Vector3, velocity: THREE.Vector3): void {
    const casing = this.pool[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % poolSize;
    casing.mesh.position.copy(position);
    casing.mesh.scale.setScalar(1);
    casing.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    casing.mesh.visible = true;
    casing.velocity.copy(velocity);
    casing.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * maxSpinRadPerSec);
    casing.ageSec = 0;
    casing.resting = false;
    casing.active = true;
  }

  update(dtSec: number): void {
    for (const casing of this.pool) {
      if (!casing.active) continue;
      casing.ageSec += dtSec;
      const leftSec = casingConfig.lifetimeSec - casing.ageSec;
      if (leftSec <= 0) {
        casing.active = false;
        casing.mesh.visible = false;
        continue;
      }
      if (leftSec < fadeSec) casing.mesh.scale.setScalar(Math.max(leftSec / fadeSec, 0.01));
      if (!casing.resting) this.fly(casing, dtSec);
    }
  }

  /** One step of flight: fall, and bounce if the path hits something. */
  private fly(casing: Casing, dtSec: number): void {
    const { mesh, velocity } = casing;
    velocity.y -= casingConfig.gravityMps2 * dtSec;
    this.step.copy(velocity).multiplyScalar(dtSec);
    const distanceM = this.step.length();
    mesh.rotation.x += casing.spin.x * dtSec;
    mesh.rotation.y += casing.spin.y * dtSec;
    mesh.rotation.z += casing.spin.z * dtSec;
    if (distanceM < 1e-6) return;

    this.direction.copy(this.step).divideScalar(distanceM);
    if (!this.collision.raycast(mesh.position, this.direction, distanceM + skinM, this.hit)) {
      mesh.position.add(this.step);
      return;
    }

    // Bounce: put it back on the surface, reflect the speed into it with some lost, and slow the sideways slide.
    const { normal, point } = this.hit;
    mesh.position.copy(point).addScaledVector(normal, skinM);
    const intoSurface = velocity.dot(normal);
    if (intoSurface < 0) {
      velocity.addScaledVector(normal, -(1 + casingConfig.restitution) * intoSurface);
      const along = velocity.dot(normal);
      this.step.copy(velocity).addScaledVector(normal, -along); // the sideways part
      velocity.addScaledVector(this.step, -casingConfig.friction);
    }
    if (velocity.length() < casingConfig.restSpeedMps && normal.y > 0.7) {
      casing.resting = true; // lying on something facing up: stop and lie flat
      velocity.set(0, 0, 0);
      mesh.rotation.set(0, mesh.rotation.y, 0);
    } else {
      casing.spin.multiplyScalar(0.7);
    }
  }
}
