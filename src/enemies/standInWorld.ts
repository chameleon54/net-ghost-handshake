import { Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { playerConfig } from '../config/player';
import { rifleConfig } from '../config/rifle';
import { standInConfig } from '../config/standInEnemy';
import type { EventBus } from '../core/events';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { WeaponEvents } from '../weapons/events';
import type { StandInEnemy, StandInHooks } from './standInEnemy';

/** What the stand-in needs to know about Rook. The Player fits this. */
export interface StandInQuarry {
  /** His feet. */
  readonly position: Vector3;
  readonly eyeHeightNowM: number;
}

// The stand-in's real senses and gun: rays through the level for sight, the level's collision for walking, and the
// bullet itself. A round's hit or miss is already decided; this only places it. A hit lands on Rook's chest and hurts him;
// a miss flies past him 0.3 to 1.5 m off and ends on whatever is behind (enemies.md, "deliberate misses"). Both send
// `shot:landed`, so the tracers, bullet marks and impact sounds work as they do for Rook's own shots.
export class StandInWorld implements StandInHooks {
  private readonly eyes = new Vector3();
  private readonly target = new Vector3();
  private readonly direction = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly aim = new Vector3();
  private readonly side = new Vector3();
  private readonly end = new Vector3();
  private readonly normal = new Vector3();
  private readonly hit = createRayHit();

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly quarry: StandInQuarry,
    /** Hurts Rook. */
    private readonly damagePlayer: (amount: number) => void,
    private readonly random: () => number = Math.random,
  ) {}

  /** It sees Rook if either his head or his chest is in clear view of its eyes. */
  canSeePlayer(enemy: StandInEnemy): boolean {
    this.eyes.set(enemy.xM, standInConfig.eyeHeightM, enemy.zM);
    const { position, eyeHeightNowM } = this.quarry;
    this.target.set(position.x, position.y + eyeHeightNowM, position.z);
    if (this.clearLine(this.eyes, this.target)) return true;
    this.chest(this.target);
    return this.clearLine(this.eyes, this.target);
  }

  pushOut(feet: Vector3): void {
    this.collision.pushOut(feet, standInConfig.capsuleRadiusM, dummyConfig.heightM, playerConfig.collisionIterations);
  }

  fire(enemy: StandInEnemy, hits: boolean): void {
    const facingX = -Math.sin(enemy.yawRad);
    const facingZ = -Math.cos(enemy.yawRad);
    this.muzzle.set(
      enemy.xM + facingX * standInConfig.muzzleForwardM,
      standInConfig.muzzleHeightM,
      enemy.zM + facingZ * standInConfig.muzzleForwardM,
    );
    this.chest(this.aim);
    let onSurface = false;
    if (hits) {
      this.end.copy(this.aim);
      this.damagePlayer(standInConfig.damagePerHit);
    } else {
      this.direction.subVectors(this.aim, this.muzzle).normalize();
      // A random direction square to the shot, so a miss can pass beside, over or under him.
      this.side.set(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1);
      this.side.addScaledVector(this.direction, -this.side.dot(this.direction));
      if (this.side.lengthSq() < 1e-6) this.side.set(this.direction.z, 0, -this.direction.x); // a rare zero: go sideways
      this.side.normalize();
      const offsetM = standInConfig.missMinOffsetM + (standInConfig.missMaxOffsetM - standInConfig.missMinOffsetM) * this.random();
      this.aim.addScaledVector(this.side, offsetM);
      this.direction.subVectors(this.aim, this.muzzle).normalize();
      if (this.collision.raycast(this.muzzle, this.direction, rifleConfig.maxRangeM, this.hit)) {
        onSurface = true;
        this.end.copy(this.hit.point);
        this.normal.copy(this.hit.normal);
      } else {
        this.end.copy(this.direction).multiplyScalar(rifleConfig.maxRangeM).add(this.muzzle);
      }
    }
    this.events.emit('enemy:fired', { position: this.muzzle });
    this.events.emit('shot:landed', { muzzle: this.muzzle, end: this.end, hit: onSurface, normal: this.normal, shooter: 'enemy' });
  }

  /** Where it aims on Rook: about his chest, lower when he crouches. */
  private chest(out: Vector3): Vector3 {
    const { position, eyeHeightNowM } = this.quarry;
    return out.set(position.x, position.y + eyeHeightNowM * standInConfig.aimHeightShareOfEyes, position.z);
  }

  private clearLine(from: Vector3, to: Vector3): boolean {
    const distanceM = from.distanceTo(to);
    this.direction.subVectors(to, from).divideScalar(distanceM);
    return this.collision.rayDistance(from, this.direction, distanceM) === Infinity;
  }
}
