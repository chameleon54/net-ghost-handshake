import { Line3, Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { exposureConfig } from '../config/exposure';
import { grenadeConfig } from '../config/grenade';
import { playerConfig } from '../config/player';
import { rifleConfig } from '../config/rifle';
import { standInConfig } from '../config/standInEnemy';
import type { EventBus } from '../core/events';
import { createRayHit, type LevelCollision } from '../level/collision';
import type { CoverPoint, CoverPoints } from '../level/cover';
import type { Navigation } from '../level/navigation';
import { hitChance, missOffsetM, type Glimpse } from '../player/exposure';
import { squadConfig } from '../config/squad';
import { SquadCoordinator } from '../squad/squadCoordinator';
import type { WeaponEvents } from '../weapons/events';
import { peekEyesAt, peekWays, type StandInEnemy, type StandInHooks, type StandInShot } from './standInEnemy';

/** What the stand-in needs to know about Rook. */
export interface StandInQuarry {
  /** His feet. */
  readonly position: Vector3;
  readonly eyeHeightNowM: number;
  /** Where his eyes really are, lean included (the camera). */
  readonly eyes: Vector3;
  /** Which way he looks: a unit vector (the camera's direction). */
  readonly forward: Vector3;
  /** True if `point` is on his screen (blocking is checked separately). */
  inView(point: Vector3): boolean;
  /** His exposure meter, 0 to 1 (4.5). */
  readonly exposure: number;
  /** True while he sprints or slides: harder to hit. */
  readonly movingFast: boolean;
}

/** A miss tries this many aim points, looking for one that strikes a surface near Rook. */
const missTries = 4;
/** A flank route is checked for being in Rook's view at points this far apart. */
const routeSampleM = 1;
/** In a flank plan's cost, one metre in Rook's view counts as much as this many metres of walking: least exposed first. */
const exposedCostPerM = 100;

/** Where a flank goes, and what it costs (metres in Rook's view weigh far more than metres walked). */
export interface FlankPlan {
  readonly point: CoverPoint;
  readonly cost: number;
}

// The stand-in's real senses and gun: rays through the level for sight, the navigation mesh and collision for walking,
// the cover points (4.3), and the bullet itself. A round's hit or miss is already decided; this only places it. A hit
// lands on Rook's chest and hurts him; a miss passes him (closer as his exposure rises), preferring to strike a surface
// near him such as his cover (enemies.md, "deliberate misses"). Both send `shot:landed`, so the tracers, bullet marks,
// sparks and impact sounds work as they do for Rook's own shots; a miss passing close by his head also sends
// `shot:near-miss` for the crack. It also measures what the stand-in sees of Rook for his exposure meter (4.5).
// It also plans flanks (4.7): which cover spot round Rook's side to go to. One world per stand-in: it remembers the spot
// its stand-in last saw Rook from.
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
  private readonly chestNow = new Vector3();
  private readonly firstMiss = new Vector3();
  private readonly bulletPath = new Line3();
  private readonly hips = new Vector3();
  private readonly peekEyes = new Vector3();
  private readonly sample = new Vector3();
  /** What it saw of Rook at the last exposure check, and when the next check is due. */
  private readonly seen: Glimpse = { visibleShare: 0, distanceM: 0, fromSide: false, inViewOfLastSpot: false };
  private glimpseTimerSec = 0;
  /** Where its eyes were when it last saw Rook (its peek spot, say), or none. */
  private readonly lastSpot = new Vector3();
  private hasLastSpot = false;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly collision: LevelCollision,
    private readonly navigation: Navigation,
    private readonly coverPoints: CoverPoints,
    private readonly quarry: StandInQuarry,
    /** Hurts Rook. `from`: where the shot came from (its muzzle). */
    private readonly damagePlayer: (amount: number, from: Vector3) => void,
    /** Where every live grenade is right now (the grenade system's `livePositions`). */
    private readonly liveGrenades: () => readonly Vector3[] = () => [],
    private readonly random: () => number = Math.random,
    /** The squad it belongs to (firing slots, hit budget); a squad of its own by default. */
    private readonly squad: SquadCoordinator = new SquadCoordinator(),
  ) {}

  requestSlot(enemy: StandInEnemy): boolean {
    return this.squad.requestSlot(enemy);
  }

  releaseSlot(enemy: StandInEnemy): void {
    this.squad.releaseSlot(enemy);
  }

  mayHit(): boolean {
    return this.squad.mayHit();
  }

  hitLanded(): void {
    this.squad.hitLanded();
  }

  claimCover(enemy: StandInEnemy, point: CoverPoint): void {
    this.coverPoints.claim(point, enemy);
  }

  flankOver(enemy: StandInEnemy): void {
    this.squad.flankOver(enemy);
  }

  disorganised(): boolean {
    return this.squad.disorganised;
  }

  downed(enemy: StandInEnemy): void {
    if (enemy.role === 'leader') this.squad.leaderDown();
  }

  /**
   * The best flank spot for this stand-in, or null (enemies.md, "Choosing cover", 4.7). A spot qualifies if it is free
   * (and not the one it holds), at least the flank angle round from where Rook looks, hides it from him (by its own prop),
   * lets a peek from it see him (his cover does not protect that side), is out of a live grenade's blast, and has a route
   * with at most the allowed metres in his view. Among those: the least exposed route, then the shortest.
   */
  planFlank(enemy: StandInEnemy): FlankPlan | null {
    const { position, eyes, forward } = this.quarry;
    const lookM = Math.hypot(forward.x, forward.z);
    const minCos = Math.cos(squadConfig.flankMinAngleDeg * (Math.PI / 180));
    let best: FlankPlan | null = null;
    for (const point of this.coverPoints.points) {
      if (point === enemy.cover) continue;
      const holder = this.coverPoints.claimedBy(point);
      if (holder && holder !== enemy) continue;
      const toX = point.xM - position.x;
      const toZ = point.zM - position.z;
      const toM = Math.hypot(toX, toZ);
      if (lookM > 1e-6 && toM > 1e-6 && (forward.x * toX + forward.z * toZ) / (lookM * toM) > minCos) continue; // in front of him
      if (!this.coverPoints.hides(point, eyes)) continue;
      if (!peekWays(point).some((way) => this.seesPlayerFrom(peekEyesAt(point, way, this.peekEyes)))) continue;
      this.spot.set(point.xM, 0, point.zM);
      if (this.grenadeNear(this.spot, grenadeConfig.blastRadiusM + standInConfig.grenadeMarginM)) continue;
      if (!this.navigation.findPath(enemy.feet, this.spot, this.routeToCover)) continue;
      const route = this.routeToCover;
      if (route[route.length - 1].distanceTo(this.spot) > standInConfig.coverArriveM) continue;
      const exposedM = this.exposedRouteM(route);
      if (exposedM > squadConfig.flankMaxExposedM) continue;
      let lengthM = 0;
      for (let i = 1; i < route.length; i++) lengthM += route[i - 1].distanceTo(route[i]);
      const cost = exposedM * exposedCostPerM + lengthM;
      if (!best || cost < best.cost) best = { point, cost };
    }
    return best;
  }

  /** How many metres of a route Rook can see a standing body's head on, checked every metre or so. */
  private exposedRouteM(route: readonly Vector3[]): number {
    let exposedM = 0;
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1];
      const to = route[i];
      const lengthM = from.distanceTo(to);
      const steps = Math.max(Math.ceil(lengthM / routeSampleM), 1);
      for (let step = 1; step <= steps; step++) {
        this.sample.lerpVectors(from, to, step / steps);
        this.sample.y += standInConfig.eyeHeightM;
        if (this.clearLine(this.quarry.eyes, this.sample)) exposedM += lengthM / steps;
      }
    }
    return exposedM;
  }

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

  hitChance(): number {
    return hitChance(this.quarry.exposure, this.quarry.movingFast);
  }

  /** Rook sees it if its head or chest is on his screen with nothing in the way. */
  rookSees(enemy: StandInEnemy): boolean {
    this.target.set(enemy.xM, enemy.eyeHeightNowM, enemy.zM);
    if (this.quarry.inView(this.target) && this.clearLine(this.quarry.eyes, this.target)) return true;
    this.target.y = enemy.muzzleHeightNowM; // about its chest
    return this.quarry.inView(this.target) && this.clearLine(this.quarry.eyes, this.target);
  }

  /**
   * What it sees of Rook, for his exposure meter: measured a few times a second, the same object between checks. Nothing
   * once it is idle or down (and it forgets where it last saw him from).
   */
  glimpse(enemy: StandInEnemy, dtSec: number): Glimpse {
    const seen = this.seen;
    if (!enemy.awake) {
      seen.visibleShare = 0;
      seen.inViewOfLastSpot = false;
      this.hasLastSpot = false;
      this.glimpseTimerSec = 0;
      return seen;
    }
    this.glimpseTimerSec -= dtSec;
    if (this.glimpseTimerSec > 0) return seen;
    this.glimpseTimerSec = 1 / exposureConfig.checksPerSec;
    this.enemyEyes.set(enemy.xM, enemy.eyeHeightNowM, enemy.zM);
    seen.visibleShare = this.visibleShareFrom(this.enemyEyes);
    const { position, forward } = this.quarry;
    const toEnemyX = enemy.xM - position.x;
    const toEnemyZ = enemy.zM - position.z;
    seen.distanceM = Math.hypot(toEnemyX, toEnemyZ);
    seen.fromSide = forward.x * toEnemyX + forward.z * toEnemyZ < 0; // more than 90 degrees from where he looks
    if (seen.visibleShare > 0) {
      this.lastSpot.copy(this.enemyEyes);
      this.hasLastSpot = true;
      seen.inViewOfLastSpot = true;
    } else {
      seen.inViewOfLastSpot = this.hasLastSpot && this.visibleShareFrom(this.lastSpot) > 0;
    }
    return seen;
  }

  /** The share of Rook's head (lean included), chest and hips in clear view from `eyes`. */
  private visibleShareFrom(eyes: Vector3): number {
    const { position, eyeHeightNowM } = this.quarry;
    this.hips.set(position.x, position.y + eyeHeightNowM * exposureConfig.hipHeightShareOfEyes, position.z);
    let clear = 0;
    if (this.clearLine(eyes, this.quarry.eyes)) clear++;
    if (this.clearLine(eyes, this.chest(this.target))) clear++;
    if (this.clearLine(eyes, this.hips)) clear++;
    return clear / 3;
  }

  peekTell(enemy: StandInEnemy): void {
    this.target.set(enemy.xM, enemy.heightM, enemy.zM);
    this.events.emit('enemy:peek-tell', { position: this.target });
  }

  pickCover(enemy: StandInEnemy): CoverPoint | null {
    return this.coverPoints.best(enemy, this.quarry.eyes, this.quarry.position, (point) => this.walkM(enemy, point), enemy.values);
  }

  coverHides(point: CoverPoint): boolean {
    return this.coverPoints.hides(point, this.quarry.eyes);
  }

  releaseCover(enemy: StandInEnemy): void {
    this.coverPoints.release(enemy);
  }

  spotGrenade(enemy: StandInEnemy, radiusM: number, out: Vector3): boolean {
    this.enemyEyes.set(enemy.xM, enemy.eyeHeightNowM, enemy.zM);
    let nearestM = Infinity;
    for (const grenade of this.liveGrenades()) {
      const distanceM = Math.hypot(grenade.x - enemy.xM, grenade.z - enemy.zM);
      if (distanceM > radiusM || distanceM >= nearestM) continue;
      if (!this.clearLine(this.enemyEyes, grenade)) continue; // it must see it (enemies.md)
      nearestM = distanceM;
      out.copy(grenade);
    }
    return nearestM < Infinity;
  }

  grenadeNear(point: Vector3, radiusM: number): boolean {
    return this.liveGrenades().some((grenade) => Math.hypot(grenade.x - point.x, grenade.z - point.z) <= radiusM);
  }

  /**
   * Prefers a cover point out of the blast that hides it from Rook, then the shortest walk, within its run limit. With
   * none, open floor straight away from the grenade, just outside the blast (or where it stands, if the mesh has no floor there).
   */
  planFlee(enemy: StandInEnemy, grenade: Vector3, safeM: number, out: Vector3): CoverPoint | null {
    let best: CoverPoint | null = null;
    let bestHides = false;
    let bestWalkM = Infinity;
    for (const point of this.coverPoints.points) {
      const holder = this.coverPoints.claimedBy(point);
      if (holder && holder !== enemy) continue;
      if (Math.hypot(point.xM - grenade.x, point.zM - grenade.z) < safeM) continue;
      const walk = this.walkM(enemy, point);
      if (walk > standInConfig.grenadeRunMaxM) continue;
      const hides = this.coverPoints.hides(point, this.quarry.eyes);
      if ((hides && !bestHides) || (hides === bestHides && walk < bestWalkM)) {
        best = point;
        bestHides = hides;
        bestWalkM = walk;
      }
    }
    if (best) {
      this.coverPoints.claim(best, enemy);
      out.set(best.xM, 0, best.zM);
      return best;
    }
    this.coverPoints.release(enemy);
    let awayX = enemy.xM - grenade.x;
    let awayZ = enemy.zM - grenade.z;
    const fromGrenadeM = Math.hypot(awayX, awayZ);
    if (fromGrenadeM < 1e-3) {
      awayX = Math.sin(enemy.yawRad); // right on top of it: straight back
      awayZ = Math.cos(enemy.yawRad);
    } else {
      awayX /= fromGrenadeM;
      awayZ /= fromGrenadeM;
    }
    const runM = Math.max(safeM - fromGrenadeM, 0) + standInConfig.coverArriveM;
    this.spot.set(enemy.xM + awayX * runM, 0, enemy.zM + awayZ * runM);
    if (!this.navigation.closestPoint(this.spot, out)) out.copy(enemy.feet);
    out.y = 0;
    return null;
  }

  grenadeSpotted(enemy: StandInEnemy): void {
    this.target.set(enemy.xM, enemy.heightM, enemy.zM);
    this.events.emit('enemy:grenade-spotted', { position: this.target });
  }

  /**
   * How far it would walk to reach a spot along the navigation mesh, or Infinity if the route does not get there or the
   * spot is inside the blast of a live grenade (so it never picks cover next to one).
   */
  private walkM(enemy: StandInEnemy, point: CoverPoint): number {
    this.spot.set(point.xM, 0, point.zM);
    if (this.grenadeNear(this.spot, grenadeConfig.blastRadiusM + standInConfig.grenadeMarginM)) return Infinity;
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
   * A hit lands on Rook's chest and hurts him. A miss passes him, closer as his exposure rises, and prefers to strike a
   * surface near him. A shot at his cover aims at chest height where it last knew he was, so it strikes whatever hides
   * him there (decisions 207 and 213). A miss or cover shot passing close by his head cracks.
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
      this.damagePlayer(standInConfig.damagePerHit, this.muzzle);
    } else {
      if (shot === 'miss') this.placeMiss();
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
    if (shot !== 'hit') this.crackIfClose();
  }

  /**
   * Picks a miss's aim point (in `aim`, which holds Rook's chest): a few tries off his chest, keeping the first that
   * strikes a surface near him (his cover takes the fire); if none does, the first try, which flies past him.
   */
  private placeMiss(): void {
    this.chestNow.copy(this.aim);
    const offsetM = missOffsetM(this.quarry.exposure);
    for (let i = 0; i < missTries; i++) {
      this.aim.copy(this.chestNow);
      this.direction.subVectors(this.aim, this.muzzle).normalize();
      this.offsetAim(offsetM);
      if (i === 0) this.firstMiss.copy(this.aim);
      this.direction.subVectors(this.aim, this.muzzle).normalize();
      const struck = this.collision.raycast(this.muzzle, this.direction, rifleConfig.maxRangeM, this.hit);
      if (struck && this.hit.point.distanceTo(this.chestNow) <= exposureConfig.missNearSurfaceM) return;
    }
    this.aim.copy(this.firstMiss);
  }

  /** A round that flew past his head within the crack radius (not one that stopped short of him) sends `shot:near-miss`. */
  private crackIfClose(): void {
    this.bulletPath.set(this.muzzle, this.end);
    const along = this.bulletPath.closestPointToPointParameter(this.quarry.eyes, false);
    if (along <= 0 || along >= 1) return; // it stopped before reaching him
    this.bulletPath.at(along, this.target);
    const distanceM = this.target.distanceTo(this.quarry.eyes);
    if (distanceM > exposureConfig.crackRadiusM) return;
    this.events.emit('shot:near-miss', { position: this.target, distanceM, exposure: this.quarry.exposure });
  }

  /** Moves the aim point `offsetM` off where it is, square to the shot, so a miss passes beside, over or under him. */
  private offsetAim(offsetM: number): void {
    this.side.set(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1);
    this.side.addScaledVector(this.direction, -this.side.dot(this.direction));
    if (this.side.lengthSq() < 1e-6) this.side.set(this.direction.z, 0, -this.direction.x); // a rare zero: go sideways
    this.side.normalize();
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
