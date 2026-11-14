import * as THREE from 'three';
import { audioConfig } from '../../config/audio';
import { grenadeConfig } from '../../config/grenade';
import type { EventBus } from '../../core/events';
import type { Target } from '../../enemies/target';
import { createRayHit, type LevelCollision } from '../../level/collision';
import type { WeaponEvents } from '../events';
import { resolveBlast, type BlastTarget } from './blast';
import { Grenade, type GrenadeHooks } from './grenade';

const poolSize = 6; // the carry limit is 2, so this is more than enough, even with one exploding as another flies
const grenadeRadiusM = 0.04;
const grenadeColour = 0x3d4a2c;
const handForwardM = 0.4; // where the grenade leaves the hand: this far in front of the eyes
const wallGapM = 0.1; // against a wall it starts this far from it

/** A dummy (or the stand-in enemy) as something a blast can hurt. */
export function dummyBlastTarget(dummy: Target, events: EventBus<WeaponEvents>): BlastTarget {
  return {
    // A crouched target's chest is lower, so cover it crouches behind also shields it from a blast.
    chest: (out) => out.set(dummy.xM, Math.min(grenadeConfig.targetChestHeightM, dummy.heightM * grenadeConfig.targetChestShareOfHeight), dummy.zM),
    vulnerable: () => dummy.hittable,
    hurt: (damage) => {
      const killed = dummy.hit('body', damage);
      events.emit('target:hit', { zone: 'body', killed, weapon: 'grenade' });
    },
  };
}

// Throws and flies the grenades. It listens for the moment the thrower lets go, spawns a grenade in front of the player,
// steps every live grenade each update, and on a blast hurts whatever is in range and says what happened (events), so
// the effects, the sound, and later glass and enemies can react.
export class GrenadeSystem implements GrenadeHooks {
  private readonly pool: { grenade: Grenade; mesh: THREE.Mesh }[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly spawn = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly chest = new THREE.Vector3();
  private readonly hit = createRayHit();

  constructor(
    scene: THREE.Scene,
    private readonly events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly camera: THREE.PerspectiveCamera,
    /** Everything a blast can hurt apart from the player. */
    private readonly targets: readonly BlastTarget[],
    /** The player: the damage he would take is published (`player:blast`) for the health system to use. */
    private readonly player: BlastTarget,
  ) {
    const geometry = new THREE.SphereGeometry(grenadeRadiusM, 12, 8);
    const material = new THREE.MeshStandardMaterial({ color: grenadeColour, roughness: 0.6, metalness: 0.3 });
    for (let i = 0; i < poolSize; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ grenade: new Grenade(), mesh });
    }
    events.on('grenade:release', () => this.throwGrenade());
  }

  /** How many grenades are in the air or waiting to go off. */
  get live(): number {
    return this.pool.filter((p) => p.grenade.active).length;
  }

  /** Removes every grenade in the air without a blast (instant restart). */
  clear(): void {
    for (const { grenade, mesh } of this.pool) {
      grenade.active = false;
      mesh.visible = false;
    }
  }

  update(dtSec: number): void {
    for (const { grenade, mesh } of this.pool) {
      if (!grenade.active) continue;
      grenade.update(dtSec, this.collision, this);
      mesh.visible = grenade.active;
      mesh.position.copy(grenade.position);
    }
  }

  onBounce(position: THREE.Vector3, speedMps: number): void {
    this.events.emit('grenade:bounced', { position, speedMps });
  }

  onExplode(position: THREE.Vector3): void {
    this.events.emit('grenade:exploded', { position, radiusM: grenadeConfig.blastRadiusM });
    resolveBlast(position, this.collision, this.targets);

    // The player: what he would take is published for the health system (3.1), and a close blast rings his ears.
    for (const result of resolveBlast(position, this.collision, [this.player])) {
      this.events.emit('player:blast', { damage: result.damage, distanceM: result.distanceM });
    }
    this.player.chest(this.chest);
    const distanceM = this.chest.distanceTo(position);
    if (distanceM < audioConfig.earRingingRadiusM) {
      // Even from behind cover. The sound is added later; the hook is here.
      const intensity = 1 - distanceM / audioConfig.earRingingRadiusM;
      this.events.emit('player:deafened', { intensity, durationSec: intensity * audioConfig.earRingingMaxSec });
    }
  }

  private throwGrenade(): void {
    const slot = this.pool.find((p) => !p.grenade.active);
    if (!slot) return; // never happens with a carry limit of 2
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.direction);
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();

    // It leaves the hand in front of the eyes, but not through a wall that is right there.
    let forwardM = handForwardM;
    if (this.collision.raycast(this.eye, this.direction, handForwardM + wallGapM, this.hit)) {
      forwardM = Math.max(this.hit.distanceM - wallGapM, 0);
    }
    this.spawn.copy(this.direction).multiplyScalar(forwardM).add(this.eye);

    // Aimed a little above where you look, as people throw.
    this.tilt.setFromAxisAngle(this.right, grenadeConfig.throwUpRad);
    this.velocity.copy(this.direction).applyQuaternion(this.tilt).multiplyScalar(grenadeConfig.throwSpeedMps);

    slot.grenade.launch(this.spawn, this.velocity);
    slot.mesh.position.copy(this.spawn);
    slot.mesh.visible = true;
    this.events.emit('grenade:thrown', { position: this.spawn, velocity: this.velocity });
  }
}
