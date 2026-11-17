import { Vector3 } from 'three';
import { enemyGrenadeConfig } from '../../config/enemyGrenades';
import { grenadeConfig } from '../../config/grenade';
import { createRayHit, type LevelCollision } from '../../level/collision';

const skinM = 0.02; // a bounced grenade is put this far off the surface so it does not sink in
const floorNormalY = 0.7; // a surface facing up at least this much counts as ground it can land and rest on

/** What the grenade tells the world as it moves. The vectors are reused: read them straight away. */
export interface GrenadeHooks {
  onBounce(position: Vector3, speedMps: number): void;
  onExplode(position: Vector3): void;
  /** An enemy grenade's warning beep (4.12). */
  onBeep?(position: Vector3): void;
}

// One grenade in flight: simple ballistics, as weapons.md asks, with no physics engine. It falls, bounces off the floor,
// walls and props (the level's ray test finds them, the same trick as the casings), comes to rest, and explodes when its
// fuse runs out, wherever it is. An enemy's grenade (4.12, decision 249) counts its fuse from when it first lands, not
// from the throw, and beeps as a warning, faster as the fuse runs out. No drawing code here.
export class Grenade {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  active = false;
  resting = false;
  /** Seconds left on the fuse. */
  fuseLeftSec = 0;
  /** True for an enemy's grenade (4.12). */
  enemy = false;
  /** True once it has first touched the ground. */
  landed = false;

  private beepLeftSec = 0;
  private readonly step = new Vector3();
  private readonly direction = new Vector3();
  private readonly hit = createRayHit();

  /** Starts a grenade at `position` moving at `velocity`, with a full fuse. `enemy`: an enemy threw it (4.12). */
  launch(position: Vector3, velocity: Vector3, enemy = false): void {
    this.position.copy(position);
    this.velocity.copy(velocity);
    this.enemy = enemy;
    this.fuseLeftSec = enemy ? enemyGrenadeConfig.fuseSec : grenadeConfig.fuseSec;
    this.active = true;
    this.resting = false;
    this.landed = false;
    this.beepLeftSec = 0; // an enemy grenade beeps straight away
  }

  /** One update: fall, bounce, count the fuse down, and explode once when it ends. */
  update(dtSec: number, collision: LevelCollision, hooks: GrenadeHooks): void {
    if (!this.active) return;
    if (!this.resting) this.fly(dtSec, collision, hooks);
    if (!this.enemy || this.landed) this.fuseLeftSec -= dtSec; // an enemy grenade's fuse starts on landing
    if (this.enemy) this.beep(dtSec, hooks);
    if (this.fuseLeftSec <= 0) {
      this.active = false;
      hooks.onExplode(this.position);
    }
  }

  private fly(dtSec: number, collision: LevelCollision, hooks: GrenadeHooks): void {
    this.velocity.y -= grenadeConfig.gravityMps2 * dtSec;
    this.step.copy(this.velocity).multiplyScalar(dtSec);
    const distanceM = this.step.length();
    if (distanceM < 1e-6) return;

    this.direction.copy(this.step).divideScalar(distanceM);
    if (!collision.raycast(this.position, this.direction, distanceM + skinM, this.hit)) {
      this.position.add(this.step);
      return;
    }

    // A bounce: put it back on the surface, turn the speed into it around, and keep only some of it.
    const { normal, point } = this.hit;
    this.position.copy(point).addScaledVector(normal, skinM);
    const intoSurface = this.velocity.dot(normal);
    if (intoSurface < 0) {
      this.velocity.addScaledVector(normal, -(1 + grenadeConfig.restitution) * intoSurface);
      const along = this.velocity.dot(normal);
      this.step.copy(this.velocity).addScaledVector(normal, -along); // the sideways part
      this.velocity.addScaledVector(this.step, -grenadeConfig.friction);
      hooks.onBounce(this.position, -intoSurface);
    }
    if (normal.y > floorNormalY) this.landed = true;
    if (this.velocity.length() < grenadeConfig.restSpeedMps && normal.y > floorNormalY) {
      this.resting = true; // lying on something facing up
      this.velocity.set(0, 0, 0);
    }
  }

  /** The warning beep: slow in flight, then closer together as the fuse runs out. */
  private beep(dtSec: number, hooks: GrenadeHooks): void {
    this.beepLeftSec -= dtSec;
    if (this.beepLeftSec > 0) return;
    hooks.onBeep?.(this.position);
    const { beepSlowSec, beepFastSec, fuseSec } = enemyGrenadeConfig;
    const fuseShare = this.landed && fuseSec > 0 ? Math.min(Math.max(this.fuseLeftSec / fuseSec, 0), 1) : 1;
    this.beepLeftSec = beepFastSec + (beepSlowSec - beepFastSec) * fuseShare;
  }
}
