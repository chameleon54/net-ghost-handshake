import * as THREE from 'three';
import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { WeaponEvents } from './events';
import { Recoil } from './recoil';

// Turns "a round left the gun" into "the bullet landed there". The bullet flies where the camera looks
// (recoil included, since the camera already has it) and is instant-hit.
export class Shooter {
  readonly recoil = new Recoil();
  private readonly hit = createRayHit();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(
    events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly camera: THREE.PerspectiveCamera,
    /** The muzzle, in the camera's own space (right, up, forward is -z). */
    private readonly muzzleInCamera: THREE.Vector3,
  ) {
    events.on('weapon:fired', () => {
      this.recoil.kick(Math.random() * 2 - 1);
      this.shoot(events);
    });
  }

  private shoot(events: EventBus<WeaponEvents>): void {
    // The camera was placed on the last screen frame; make sure its world matrix matches.
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.direction);
    this.muzzle.copy(this.muzzleInCamera);
    this.camera.localToWorld(this.muzzle);

    const hit = this.collision.raycast(this.origin, this.direction, rifleConfig.maxRangeM, this.hit);
    if (hit) {
      this.end.copy(this.hit.point);
      this.normal.copy(this.hit.normal);
    } else {
      this.end.copy(this.direction).multiplyScalar(rifleConfig.maxRangeM).add(this.origin);
    }
    events.emit('shot:landed', { muzzle: this.muzzle, end: this.end, hit, normal: this.normal });
  }
}
