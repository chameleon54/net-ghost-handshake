import * as THREE from 'three';
import type { GunConfig } from '../config/gun';
import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import type { Dummy, HitZone } from '../enemies/dummy';
import { createDummyHit, rayHitDummy } from '../enemies/dummyHit';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { GunId, WeaponEvents } from './events';
import { applySpread } from './spread';
import { Recoil } from './recoil';

// Turns "a round left the gun" into "the bullet landed there". The bullet flies where the camera looks
// (recoil included, since the camera already has it) and is instant-hit.
export class Shooter {
  readonly recoil = new Recoil();
  /** How far into aiming the player is (0 hip, 1 aimed); set every update. It tightens the spread. */
  aimBlend = 0;
  private readonly hit = createRayHit();
  private readonly dummyHit = createDummyHit();
  private readonly ray = new THREE.Ray();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private zone: HitZone = 'body';

  constructor(
    events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly camera: THREE.PerspectiveCamera,
    /** Each gun's muzzle, in the camera's own space (right, up, forward is -z). */
    private readonly muzzlesInCamera: Record<GunId, THREE.Vector3>,
    private readonly dummies: readonly Dummy[],
    private readonly configs: Record<GunId, GunConfig>,
  ) {
    events.on('weapon:fired', ({ weapon }) => {
      this.recoil.kick(Math.random() * 2 - 1, configs[weapon]);
      this.shoot(events, weapon);
    });
  }

  private shoot(events: EventBus<WeaponEvents>, weapon: GunId): void {
    // The camera was placed on the last screen frame; make sure its world matrix matches.
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.direction);
    const config = this.configs[weapon];
    const spreadRad = config.hipSpreadRad + (config.aimedSpreadRad - config.hipSpreadRad) * this.aimBlend;
    applySpread(this.direction, spreadRad, Math.random(), Math.random());
    this.muzzle.copy(this.muzzlesInCamera[weapon]);
    this.camera.localToWorld(this.muzzle);

    const hit = this.collision.raycast(this.origin, this.direction, rifleConfig.maxRangeM, this.hit);

    // The nearest standing dummy in front of any wall takes the bullet.
    this.ray.set(this.origin, this.direction);
    let target: Dummy | null = null;
    let targetM = hit ? this.hit.distanceM : rifleConfig.maxRangeM;
    for (const dummy of this.dummies) {
      if (rayHitDummy(this.ray, dummy, targetM, this.dummyHit)) {
        target = dummy;
        targetM = this.dummyHit.distanceM;
        this.end.copy(this.dummyHit.point);
        this.zone = this.dummyHit.zone;
      }
    }

    let onSurface = false;
    if (target) {
      const killed = target.hit(this.zone, config.bodyDamagePerHit);
      events.emit('target:hit', { zone: this.zone, killed });
    } else if (hit) {
      onSurface = true;
      this.end.copy(this.hit.point);
      this.normal.copy(this.hit.normal);
    } else {
      this.end.copy(this.direction).multiplyScalar(rifleConfig.maxRangeM).add(this.origin);
    }
    events.emit('shot:landed', { muzzle: this.muzzle, end: this.end, hit: onSurface, normal: this.normal });
  }
}
