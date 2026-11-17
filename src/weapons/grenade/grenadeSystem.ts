import * as THREE from 'three';
import { audioConfig } from '../../config/audio';
import { enemyGrenadeConfig } from '../../config/enemyGrenades';
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
const trailColour = 0xffb040; // warm and bright, so an enemy grenade's flight is easy to follow
const trailOpacity = 0.85;
const trailPointCount = 64; // enough for the longest trail the panel allows at 60 updates a second

/** A dummy (or the stand-in enemy) as something a blast can hurt. */
export function dummyBlastTarget(dummy: Target, events: EventBus<WeaponEvents>): BlastTarget {
  return {
    // A crouched target's chest is lower, so cover it crouches behind also shields it from a blast.
    chest: (out) => out.set(dummy.xM, Math.min(grenadeConfig.targetChestHeightM, dummy.heightM * grenadeConfig.targetChestShareOfHeight), dummy.zM),
    vulnerable: () => dummy.hittable,
    hurt: (damage, byPlayer) => {
      const killed = dummy.hit('body', damage);
      if (byPlayer) events.emit('target:hit', { zone: 'body', killed, weapon: 'grenade' }); // the hit marker is for Rook's hits
    },
  };
}

/** One grenade of the pool: its rules, its mesh, and the trail drawn behind an enemy's grenade in flight (4.12). */
interface Slot {
  grenade: Grenade;
  mesh: THREE.Mesh;
  trail: THREE.Line;
  /** The trail's points, newest first, as x, y, z triples. */
  trailPoints: Float32Array;
}

// Throws and flies the grenades. It listens for the moment the thrower lets go, spawns a grenade in front of the player,
// steps every live grenade each update, and on a blast hurts whatever is in range and says what happened (events), so
// the effects, the sound, and later glass and enemies can react. Since 4.12 (decision 249) enemies throw too
// (`throwEnemyGrenade`): their grenades fly the same way, draw a short trail in flight, and beep as a warning.
export class GrenadeSystem implements GrenadeHooks {
  private readonly pool: Slot[] = [];
  /** The grenade being updated now, so a blast knows whose it was. */
  private current: Grenade | null = null;
  private readonly enemyPoints: THREE.Vector3[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly spawn = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly chest = new THREE.Vector3();
  private readonly hit = createRayHit();
  private readonly livePoints: THREE.Vector3[] = [];

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
    const trailMaterial = new THREE.LineBasicMaterial({ color: trailColour, transparent: true, opacity: trailOpacity });
    for (let i = 0; i < poolSize; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      const trailPoints = new Float32Array(trailPointCount * 3);
      const trailGeometry = new THREE.BufferGeometry();
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPoints, 3));
      const trail = new THREE.Line(trailGeometry, trailMaterial);
      trail.visible = false;
      trail.frustumCulled = false; // its points move every update; its bounds are never recomputed
      scene.add(trail);
      this.pool.push({ grenade: new Grenade(), mesh, trail, trailPoints });
    }
    events.on('grenade:release', () => this.throwGrenade());
  }

  /** How many grenades are in the air or waiting to go off. */
  get live(): number {
    return this.pool.filter((p) => p.grenade.active).length;
  }

  /** True while an enemy's grenade is in the air or waiting to go off (one at a time, enemies.md). */
  get enemyGrenadeLive(): boolean {
    return this.pool.some((p) => p.grenade.active && p.grenade.enemy);
  }

  /** Where every live enemy grenade is, for the HUD's warning marker. The array and its vectors are reused: read them straight away. */
  liveEnemyGrenades(): readonly THREE.Vector3[] {
    this.enemyPoints.length = 0;
    for (const { grenade } of this.pool) if (grenade.active && grenade.enemy) this.enemyPoints.push(grenade.position);
    return this.enemyPoints;
  }

  /** An enemy lets go of a grenade at `from` moving at `velocity` (4.12): it flies like Rook's, with its own fuse and warnings. */
  throwEnemyGrenade(from: THREE.Vector3, velocity: THREE.Vector3): void {
    const slot = this.pool.find((p) => !p.grenade.active);
    if (!slot) return; // shortcut: only if six are live at once, which one enemy grenade at a time never reaches
    slot.grenade.launch(from, velocity, true);
    slot.mesh.position.copy(from);
    slot.mesh.visible = true;
    for (let i = 0; i < trailPointCount; i++) slot.trailPoints.set([from.x, from.y, from.z], i * 3);
    slot.trail.visible = true;
    this.events.emit('enemy:grenade-thrown', { position: from });
  }

  /**
   * Where every live grenade is right now, for enemies to react to. An enemy's own grenade counts only once it has
   * landed (4.12): in flight it starts at the thrower's hand, and they react to one that lands near them (enemies.md).
   * The array and its vectors are reused: read them straight away.
   */
  livePositions(): readonly THREE.Vector3[] {
    this.livePoints.length = 0;
    for (const { grenade } of this.pool) if (grenade.active && (!grenade.enemy || grenade.landed)) this.livePoints.push(grenade.position);
    return this.livePoints;
  }

  /** Removes every grenade in the air without a blast (instant restart). */
  clear(): void {
    for (const { grenade, mesh, trail } of this.pool) {
      grenade.active = false;
      mesh.visible = false;
      trail.visible = false;
    }
  }

  update(dtSec: number): void {
    for (const slot of this.pool) {
      const { grenade, mesh } = slot;
      if (!grenade.active) continue;
      this.current = grenade;
      grenade.update(dtSec, this.collision, this);
      this.current = null;
      mesh.visible = grenade.active;
      mesh.position.copy(grenade.position);
      if (grenade.enemy) this.updateTrail(slot, dtSec);
    }
  }

  /** The trail follows an enemy grenade in flight, about `trailSec` long, and goes once it lands. */
  private updateTrail({ grenade, trail, trailPoints }: Slot, dtSec: number): void {
    trail.visible = grenade.active && !grenade.landed;
    if (!trail.visible) return;
    // Each update the points move one place back; how many places make up `trailSec` depends on the update length.
    const shown = Math.min(Math.max(Math.round(enemyGrenadeConfig.trailSec / Math.max(dtSec, 1e-3)), 2), trailPointCount);
    trailPoints.copyWithin(3, 0, (trailPointCount - 1) * 3);
    trailPoints.set([grenade.position.x, grenade.position.y, grenade.position.z], 0);
    trail.geometry.setDrawRange(0, shown);
    trail.geometry.attributes.position.needsUpdate = true;
  }

  onBounce(position: THREE.Vector3, speedMps: number): void {
    this.events.emit('grenade:bounced', { position, speedMps });
  }

  onBeep(position: THREE.Vector3): void {
    this.events.emit('grenade:beep', { position });
  }

  onExplode(position: THREE.Vector3): void {
    const byPlayer = !(this.current?.enemy ?? false);
    this.events.emit('grenade:exploded', { position, radiusM: grenadeConfig.blastRadiusM });
    resolveBlast(position, this.collision, this.targets, byPlayer); // an enemy's grenade hurts enemies too (decision 249)

    // The player: what he would take is published for the health system (3.1), and a close blast rings his ears.
    for (const result of resolveBlast(position, this.collision, [this.player], byPlayer)) {
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
