import * as THREE from 'three';
import { knifeConfig } from '../config/knife';
import type { EventBus } from '../core/events';
import type { Dummy } from '../enemies/dummy';
import { createDummyHit, rayHitDummy } from '../enemies/dummyHit';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { WeaponEvents } from './events';

// Works out what a knife swing hits: the nearest standing dummy within reach, in front of the camera, with no wall
// between. From behind it kills at once; from the front it does the knife's damage.
export class KnifeStrike {
  private readonly ray = new THREE.Ray();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly wallHit = createRayHit();
  private readonly dummyHit = createDummyHit();

  constructor(
    events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dummies: readonly Dummy[],
  ) {
    events.on('weapon:swing', () => this.strike(events));
  }

  private strike(events: EventBus<WeaponEvents>): void {
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.direction);
    this.ray.set(this.origin, this.direction);

    // A wall in reach shortens the knife's reach: nothing behind it can be stabbed.
    const wallM = this.collision.raycast(this.origin, this.direction, knifeConfig.reachM, this.wallHit)
      ? this.wallHit.distanceM
      : knifeConfig.reachM;

    let target: Dummy | null = null;
    let targetM = wallM;
    for (const dummy of this.dummies) {
      if (rayHitDummy(this.ray, dummy, targetM, this.dummyHit)) {
        target = dummy;
        targetM = this.dummyHit.distanceM;
      }
    }
    if (!target) return;

    const killed = target.isBehind(this.origin.x, this.origin.z)
      ? target.kill()
      : target.hit('body', knifeConfig.frontDamagePerHit); // the knife has no headshot
    events.emit('target:hit', { zone: 'body', killed });
  }
}
