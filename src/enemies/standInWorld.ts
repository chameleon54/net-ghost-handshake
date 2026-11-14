import { Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { playerConfig } from '../config/player';
import { rifleConfig } from '../config/rifle';
import { standInConfig } from '../config/standInEnemy';
import type { EventBus } from '../core/events';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { CoverPoint, CoverPoints } from '../level/cover';
import type { Navigation } from '../level/navigation';
import type { WeaponEvents } from '../weapons/events';
import type { StandInEnemy, StandInHooks, StandInShot } from './standInEnemy';

/** What the stand-in needs to know about Rook. */
export interface StandInQuarry {
  /** His feet. */
  readonly position: Vector3;
  readonly eyeHeightNowM: number;
  /** Where his eyes really are, lean included (the camera). */
  readonly eyes: Vector3;
}

// The stand-in's real senses and gun: rays through the level for sight, the navigation mesh and collision for walking,
// the cover points (4.3), and the
// bullet itself. A round's hit or miss is already decided; this only places it. A hit lands on Rook's chest and hurts him;
// a miss flies past him 0.3 to 1.5 m off and ends on whatever is behind (enemies.md, "deliberate misses"). Both send
// `shot:landed`, so the tracers, bullet marks and impact sounds work as they do for Rook's own shots.
export class StandInWorld implements StandInHooks {
  private readonly enemyEyes = new Vector3();
  private readonly routeToCover: Vector3[] = [];
  private readonly spot = new Vector3();
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
    private readonly navigation: Navigation,
    private readonly coverPoints: CoverPoints,
    private readonly quarry: StandInQuarry,
    /** Hurts Rook. */
    private readonly damagePlayer: (amount: number) => void,
    private readonly random: () => number = Math.random,
  ) {}

  /** It sees Rook if either his head (lean included) or his chest is in clear view of its eyes. */
  canSeePlayer(enemy: StandInEnemy): boolean {
    this.enemyEyes.set(enemy.xM, enemy.eyeHeightNowM, enemy.zM);
    return this.seesPlayerFrom(this.enemyEyes);
  }

  seesPlayerFrom(eyes: Vector3): boolean {
    if (this.clearLine(eyes, this.quarry.eyes)) return true;
    this.chest(this.target);
    return this.clearLine(eyes, this.target);
  }

  peekTell(enemy: StandInEnemy): void {
    this.target.set(enemy.xM, enemy.heightM, enemy.zM);
    this.events.emit('enemy:peek-tell', { position: this.target });
  }

  pickCover(enemy: StandInEnemy): CoverPoint | null {
    return this.coverPoints.best(enemy, this.quarry.eyes, this.quarry.position, (point) => this.walkM(enemy, point));
  }

  coverHides(point: CoverPoint): boolean {
    return this.coverPoints.hides(point, this.quarry.eyes);
  }

  releaseCover(enemy: StandInEnemy): void {
    this.coverPoints.release(enemy);
  }

  /** How far it would walk to reach a spot along the navigation mesh, or Infinity if the route does not get there. */
  private walkM(enemy: StandInEnemy, point: CoverPoint): number {
    this.spot.set(point.xM, 0, point.zM);
    if (!this.navigation.findPath(enemy.feet, this.spot, this.routeToCover)) return Infinity;
    const route = this.routeToCover;
    if (route[route.length - 1].distanceTo(this.spot) > standInConfig.coverArriveM) return Infinity;
    let lengthM = 0;
    for (let i = 1; i < route.length; i++) lengthM += route[i - 1].distanceTo(route[i]);
    return lengthM;
  }

  findPath(from: Vector3, to: Vector3, out: Vector3[]): boolean {
    return this.navigation.findPath(from, to, out);
  }

  pushOut(feet: Vector3): void {
    this.collision.pushOut(feet, standInConfig.capsuleRadiusM, dummyConfig.heightM, playerConfig.collisionIterations);
  }

  /**
   * A hit lands on Rook's chest and hurts him. A miss flies 0.3 to 1.5 m past him. A shot at his cover aims at chest
   * height where it last knew he was, so it strikes whatever hides him there (decisions 207 and 213).
   */
  fire(enemy: StandInEnemy, shot: StandInShot): void {
    const facingX = -Math.sin(enemy.yawRad);
    const facingZ = -Math.cos(enemy.yawRad);
    this.muzzle.set(
      enemy.xM + facingX * standInConfig.muzzleForwardM,
      enemy.muzzleHeightNowM,
      enemy.zM + facingZ * standInConfig.muzzleForwardM,
    );
    this.chest(this.aim);
    if (shot === 'cover' && enemy.knowsWhere) this.aim.set(enemy.lastKnown.x, this.aim.y - this.quarry.position.y, enemy.lastKnown.z);
    let onSurface = false;
    if (shot === 'hit') {
      this.end.copy(this.aim);
      this.damagePlayer(standInConfig.damagePerHit);
    } else {
      this.direction.subVectors(this.aim, this.muzzle).normalize();
      if (shot === 'miss') this.offsetAim();
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

  /** Moves the aim point 0.3 to 1.5 m off Rook's chest, square to the shot, so a miss passes beside, over or under him. */
  private offsetAim(): void {
    this.side.set(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1);
    this.side.addScaledVector(this.direction, -this.side.dot(this.direction));
    if (this.side.lengthSq() < 1e-6) this.side.set(this.direction.z, 0, -this.direction.x); // a rare zero: go sideways
    this.side.normalize();
    const offsetM = standInConfig.missMinOffsetM + (standInConfig.missMaxOffsetM - standInConfig.missMinOffsetM) * this.random();
    this.aim.addScaledVector(this.side, offsetM);
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
