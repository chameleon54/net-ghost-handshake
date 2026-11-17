import { Line3, Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { enemyGrenadeConfig } from '../config/enemyGrenades';
import { enemyGunConfig } from '../config/enemyGuns';
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
import { coverConfig } from '../config/cover';
import { SquadCoordinator } from '../squad/squadCoordinator';
import type { WeaponEvents } from '../weapons/events';
import { lobIsClear, lobVelocity } from './grenadeLob';
import { peekEyesAt, peekGunAt, peekWays, type StandInEnemy, type StandInHooks, type StandInShot, type ThrowPlan } from './standInEnemy';

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

/** A noise's line to the ears skips this much at each end (the surface the noise was made on does not muffle it). */
const noiseSurfaceM = 0.1;
/** Rook's near miss checks a stand-in's chest at this share of its height (with its head). */
const coverChestShare = 0.6;
/** A miss tries this many aim points, looking for one that strikes a surface near Rook. */
const missTries = 4;
/** A flank route is checked for being in Rook's view at points this far apart. */
const routeSampleM = 1;
/** In a flank plan's cost, one metre in Rook's view counts as much as this many metres of walking: least exposed first. */
const exposedCostPerM = 100;
/** A grenade throw tries this many angles, from the highest to the lowest (enemyGrenades.ts). */
const throwAngleTries = 3;
/** A lob is aimed this far above the floor at his feet (about the grenade's own size), so the floor itself is not "in the way". */
const lobLandLiftM = 0.05;

/** Where a flank goes, and what it costs (metres in Rook's view weigh far more than metres walked). */
export interface FlankPlan {
  readonly point: CoverPoint;
  readonly cost: number;
}

/** How many cover spots the last flank plan turned down, and for which rule (the first one each failed). For the dev readout. */
export interface FlankRejects {
  taken: number;
  inFront: number;
  notHidden: number;
  peekBlocked: number;
  nearGrenade: number;
  noRoute: number;
  routeSeen: number;
  /** On the first flanker's side of Rook (a pincer's second flank goes round the other side, 4.11). */
  sameSide: number;
}

/** Why no flank spot was found, in a few words (dev readout): "20 in front of you, 3 not hidden by their cover, ...". */
export function describeFlankRejects(r: FlankRejects): string {
  const parts: [number, string][] = [
    [r.inFront, 'in front of you'],
    [r.notHidden, 'not hidden by their cover'],
    [r.peekBlocked, 'peek cannot see you'],
    [r.routeSeen, 'route too much in your view'],
    [r.noRoute, 'no route'],
    [r.nearGrenade, 'near a grenade'],
    [r.taken, 'taken'],
    [r.sameSide, "on the first flanker's side"],
  ];
  const listed = parts.filter(([count]) => count > 0).map(([count, why]) => `${count} ${why}`);
  return `no flank spot (${listed.length > 0 ? listed.join(', ') : 'no cover spots'})`;
}

// The stand-in's real senses and gun: rays through the level for sight, the navigation mesh and collision for walking,
// the cover points (4.3), and the bullet itself. A round's hit or miss is already decided; this only places it. A hit
// lands on Rook's chest and hurts him; a miss passes him (closer as his exposure rises), preferring to strike a surface
// near him such as his cover (enemies.md, "deliberate misses"). Both send `shot:landed`, so the tracers, bullet marks,
// sparks and impact sounds work as they do for Rook's own shots; a miss passing close by his head also sends
// `shot:near-miss` for the crack. It also measures what the stand-in sees of Rook for his exposure meter (4.5).
// It also plans flanks (4.7): which cover spot round Rook's side to go to. One world per stand-in: it remembers the spot
// its stand-in last saw Rook from. While the squad searches for him (the hunt, decision 235), cover and routes are judged
// from where the squad last knew he was, not where he is.
export class StandInWorld implements StandInHooks {
  private readonly enemyEyes = new Vector3();
  private readonly routeToCover: Vector3[] = [];
  private readonly spot = new Vector3();
  /** Where a route from its feet starts, and a spot on the floor (pickCover's shortest possible walk, 4.13b). */
  private readonly routeStart = new Vector3();
  private readonly spotOnFloor = new Vector3();
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
  private readonly pinSide = new Vector3();
  private readonly enemyPoint = new Vector3();
  private readonly huntEyes = new Vector3();
  private readonly huntFeet = new Vector3();
  private readonly lobFrom = new Vector3();
  private readonly lobTarget = new Vector3();
  private readonly lobVelocity = new Vector3();
  /** What the last flank plan turned down (dev readout). */
  readonly flankRejects: FlankRejects = { taken: 0, inFront: 0, notHidden: 0, peekBlocked: 0, nearGrenade: 0, noRoute: 0, routeSeen: 0, sameSide: 0 };
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
    /** Throws a grenade from `from` at `velocity` (the grenade system's `throwEnemyGrenade`, 4.12). */
    private readonly launchGrenade: (from: Vector3, velocity: Vector3) => void = () => {},
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

  suppressionAllowed(): boolean {
    return this.squad.suppressionAllowed;
  }

  hunting(): boolean {
    return this.squad.hunting;
  }

  huntMoveOver(enemy: StandInEnemy): void {
    this.squad.huntMoveOver(enemy);
  }

  huntHoldScale(enemy: StandInEnemy): number {
    return this.squad.huntHoldScale(enemy);
  }

  /**
   * Where the squad judges Rook's view from when it picks cover and routes: his real eyes, or while it searches for him
   * (the hunt, decision 235) where it last knew he was, at standing eye height. Sight itself always uses his real eyes.
   */
  private get viewEyes(): Vector3 {
    if (!this.squad.searching) return this.quarry.eyes;
    const spot = this.squad.huntSpot;
    // shortcut: the floor there is taken as height 0 (as `lastKnown` is); use the floor height once levels have storeys (phase 5).
    return this.huntEyes.set(spot.x, playerConfig.eyeHeightM, spot.z);
  }

  /** His feet, as `viewEyes` judges: where he is, or while the squad searches, where it last knew he was. */
  private get viewFeet(): Vector3 {
    if (!this.squad.searching) return this.quarry.position;
    return this.huntFeet.set(this.squad.huntSpot.x, 0, this.squad.huntSpot.z);
  }

  /**
   * Where the hunt's leader goes (decision 235), or null: a free cover point within the hunt distance of where the squad
   * last knew Rook was, that hides it from that spot and lets a peek see it, and that it can reach. The least exposed
   * route (judged from that spot) wins, then the shortest walk. Asked while the hunt is on.
   */
  planHuntSpot(enemy: StandInEnemy): FlankPlan | null {
    const eyes = this.viewEyes;
    const feet = this.viewFeet;
    let best: FlankPlan | null = null;
    for (const point of this.coverPoints.points) {
      const holder = this.coverPoints.claimedBy(point);
      if (holder && holder !== enemy) continue;
      if (Math.hypot(point.xM - feet.x, point.zM - feet.z) > squadConfig.huntNearM) continue;
      if (!this.coverPoints.hides(point, eyes)) continue;
      if (!peekWays(point).some((way) => this.clearLine(peekEyesAt(point, way, this.peekEyes), eyes))) continue;
      const walk = this.walkM(enemy, point); // Infinity if unreachable or near a live grenade
      if (!Number.isFinite(walk)) continue;
      const cost = this.exposedRouteM(this.routeToCover) * exposedCostPerM + walk; // walkM left its route there
      if (!best || cost < best.cost) best = { point, cost };
    }
    return best;
  }

  keepSuppressing(enemy: StandInEnemy): boolean {
    return this.squad.keepSuppressing(enemy);
  }

  suppressOver(enemy: StandInEnemy): void {
    this.squad.suppressOver(enemy);
  }

  advanceOver(enemy: StandInEnemy): void {
    this.squad.advanceOver(enemy);
    this.squad.repositionOver(enemy); // a reposition moves like an advance
  }

  /** True if a peek from this spot (rising, or stepping out) can see Rook: a fighting spot (decision 237). */
  canFightFrom(point: CoverPoint): boolean {
    return peekWays(point).some((way) => this.seesPlayerFrom(peekEyesAt(point, way, this.peekEyes)));
  }

  /**
   * Where to move on to from a spot it has used enough (decision 237), or null: a free hiding spot (not its own) at least
   * the reposition distance from where it is and not too close to Rook, with at most the allowed metres of route in his
   * view (decision 239). Scored like choosing cover (its liked range, the walk, and a spot it cannot shoot from as a last
   * resort), plus the metres in view. Also how much of the route is in his view, to know if it may go without cover.
   */
  planReposition(enemy: StandInEnemy): (FlankPlan & { readonly exposedM: number }) | null {
    const position = this.viewFeet;
    const eyes = this.viewEyes;
    const { preferMinM, preferMaxM } = enemy.values;
    let best: (FlankPlan & { readonly exposedM: number }) | null = null;
    for (const point of this.coverPoints.points) {
      const holder = this.coverPoints.claimedBy(point);
      if (point === enemy.cover || (holder && holder !== enemy)) continue;
      if (Math.hypot(point.xM - enemy.xM, point.zM - enemy.zM) < squadConfig.repositionMinM) continue;
      const fromRookM = Math.hypot(point.xM - position.x, point.zM - position.z);
      if (fromRookM < squadConfig.advanceClosestM) continue;
      if (!this.coverPoints.hides(point, eyes)) continue;
      const walk = this.walkM(enemy, point);
      if (!Number.isFinite(walk)) continue;
      const exposedM = this.exposedRouteM(this.routeToCover); // walkM left its route there
      if (exposedM > squadConfig.moveMaxExposedM) continue;
      const outOfRangeM = Math.max(preferMinM - fromRookM, fromRookM - preferMaxM, 0);
      const blind = this.canFightFrom(point) ? 0 : coverConfig.blindSpotPenalty;
      const cost = exposedM * exposedCostPerM + outOfRangeM * coverConfig.rangePenaltyPerM + walk * coverConfig.walkPenaltyPerM + blind;
      if (!best || cost < best.cost) best = { point, cost, exposedM };
    }
    return best;
  }

  /**
   * True if a wall or prop is between a noise and the ears. The ends are left out by a hand's width, because a noise is
   * often made on a surface (a bullet in a wall, a step on the floor) and that surface does not muffle it.
   */
  noiseBlocked(from: Vector3, to: Vector3): boolean {
    const distanceM = from.distanceTo(to);
    if (distanceM <= 2 * noiseSurfaceM) return false;
    this.direction.subVectors(to, from).divideScalar(distanceM);
    this.sample.copy(from).addScaledVector(this.direction, noiseSurfaceM);
    return this.collision.rayDistance(this.sample, this.direction, distanceM - 2 * noiseSurfaceM) !== Infinity;
  }

  /**
   * The best spot to move up to (4.9), or null: a free cover point, not its own, that hides it from Rook (by its own
   * prop), at least the advance gain closer to him than where it is but not too close, out of a live grenade's blast, and
   * reachable. The move is covered by a squadmate's fire, but covering fire buys a short dash, not a long walk in the open:
   * at most the allowed metres of the route may be in his view, and the least exposed route wins, then the shortest walk
   * (decision 239). A hunt's follower (decision 235) moves up toward where the squad last knew he was, no closer than
   * `closestM` (its leader's distance from there).
   */
  planAdvance(enemy: StandInEnemy, closestM = squadConfig.advanceClosestM): FlankPlan | null {
    const position = this.viewFeet;
    const eyes = this.viewEyes;
    const nowM = Math.hypot(enemy.xM - position.x, enemy.zM - position.z);
    let best: FlankPlan | null = null;
    for (const point of this.coverPoints.points) {
      const holder = this.coverPoints.claimedBy(point);
      if (point === enemy.cover || (holder && holder !== enemy)) continue;
      const toM = Math.hypot(point.xM - position.x, point.zM - position.z);
      if (toM > nowM - squadConfig.advanceMinGainM || toM < closestM) continue;
      if (!this.coverPoints.hides(point, eyes)) continue;
      const walk = this.walkM(enemy, point); // Infinity if unreachable or near a live grenade
      if (!Number.isFinite(walk)) continue;
      const exposedM = this.exposedRouteM(this.routeToCover); // walkM left its route there
      if (exposedM > squadConfig.moveMaxExposedM) continue;
      const blind = this.canFightFrom(point) ? 0 : coverConfig.blindSpotPenalty;
      const cost = exposedM * exposedCostPerM + walk * coverConfig.walkPenaltyPerM + blind;
      if (!best || cost < best.cost) best = { point, cost };
    }
    return best;
  }

  /** True if it could pin Rook's cover from its spot: from one of its peeks, a round at either edge of his cover gets there. */
  canSuppressFrom(enemy: StandInEnemy): boolean {
    const point = enemy.cover;
    if (!point) return false;
    return peekWays(point).some((way) => this.coverShotClear(enemy, point, way, 1) || this.coverShotClear(enemy, point, way, -1));
  }

  /**
   * True if a round fired from the gun (not the eyes) of a peek from `point` going `way` would land near Rook's cover or
   * reach it: aimed at edge `side` (1 or -1) of where it last knew he was, or straight at it (0). Decision 239.
   */
  coverShotClear(enemy: StandInEnemy, point: CoverPoint, way: number, side: number): boolean {
    if (!enemy.knowsWhere) return false;
    peekGunAt(point, way, this.peekEyes);
    this.edgeAim(this.peekEyes, enemy.lastKnown, side, this.aim);
    return this.lineHitM(this.peekEyes, this.aim) >= this.peekEyes.distanceTo(this.aim) - exposureConfig.missNearSurfaceM;
  }

  /**
   * False if the round it is about to fire (aimed as `shot` aims) would strike its own cover: something within the
   * own-cover distance past its muzzle and not near where it aims (decision 239). Checked from its body, so a gun poking
   * into the cover counts too.
   */
  muzzleClear(enemy: StandInEnemy, shot: StandInShot): boolean {
    this.muzzle.set(enemy.xM, enemy.muzzleHeightNowM, enemy.zM);
    this.aimAt(enemy, shot, this.muzzle, this.aim);
    const hitM = this.lineHitM(this.muzzle, this.aim);
    const nearGun = hitM <= standInConfig.muzzleForwardM + standInConfig.ownCoverM;
    return !nearGun || hitM >= this.muzzle.distanceTo(this.aim) - exposureConfig.missNearSurfaceM;
  }

  /** How far along the line from `from` to `to` it first strikes something, or Infinity if nothing is in the way. */
  private lineHitM(from: Vector3, to: Vector3): number {
    const distanceM = from.distanceTo(to);
    this.direction.subVectors(to, from).divideScalar(distanceM);
    return this.collision.rayDistance(from, this.direction, distanceM);
  }

  /** Where a round of this kind aims from `from`, into `out`: Rook's chest, his cover, or the edge of it (suppressing). */
  private aimAt(enemy: StandInEnemy, shot: StandInShot, from: Vector3, out: Vector3): Vector3 {
    if (shot === 'suppress') return this.edgeAim(from, enemy.lastKnown, enemy.suppressSideSign, out);
    this.chest(out);
    if (shot === 'cover' && enemy.knowsWhere) out.set(enemy.lastKnown.x, out.y - this.quarry.position.y, enemy.lastKnown.z);
    return out;
  }

  /**
   * Where suppressing fire from `from` aims (4.9): chest height at the edge of Rook's cover, the suppress offset to one
   * side of where he hides, square to the line of fire. `side` 1 or -1 picks the side; `out` gets the point.
   */
  private edgeAim(from: Vector3, hide: Vector3, side: number, out: Vector3): Vector3 {
    this.edgeSide(from, hide, side, this.pinSide);
    out.set(hide.x, this.quarry.position.y + this.quarry.eyeHeightNowM * standInConfig.aimHeightShareOfEyes, hide.z);
    return out.addScaledVector(this.pinSide, squadConfig.suppressEdgeOffsetM);
  }

  /** The way to one side of `hide` as seen from `from` (horizontal, unit), into `out`. */
  private edgeSide(from: Vector3, hide: Vector3, side: number, out: Vector3): Vector3 {
    const dx = hide.x - from.x;
    const dz = hide.z - from.z;
    const lengthM = Math.hypot(dx, dz) || 1;
    return out.set((-dz / lengthM) * side, 0, (dx / lengthM) * side);
  }

  /**
   * True if a round of Rook's (from `muzzle` to `end`) passed or landed within the pin distance of this stand-in's head or
   * chest (4.9, the Suppressed state).
   */
  nearMiss(enemy: StandInEnemy, muzzle: Vector3, end: Vector3): boolean {
    this.bulletPath.set(muzzle, end);
    const pinM = squadConfig.pinnedByFireM;
    for (const heightM of [enemy.heightM - dummyConfig.headRadiusM, enemy.heightM * coverChestShare]) {
      this.enemyPoint.set(enemy.xM, heightM, enemy.zM);
      this.bulletPath.closestPointToPoint(this.enemyPoint, true, this.target);
      if (this.target.distanceTo(this.enemyPoint) <= pinM) return true;
    }
    return false;
  }

  downed(enemy: StandInEnemy): void {
    if (enemy.role === 'leader') this.squad.leaderDown();
    this.target.set(enemy.xM, 0, enemy.zM);
    this.events.emit('enemy:downed', { position: this.target, role: enemy.role, grenades: enemy.grenades }); // its drops (4.12)
  }

  /**
   * A grenade throw for this stand-in (4.12), or null: from its cover spot, within the throw range of Rook, a lob aimed
   * at his feet (scattered a little) that nothing blocks on the way. Each peek way is tried, and for each the throw
   * angles from the highest (a lob over his cover) down; the first clear one is taken. The nearer the thrower, the cheaper.
   * `point` is the spot it throws from: its cover.
   */
  planThrow(enemy: StandInEnemy, point: CoverPoint | null = enemy.cover): ThrowPlan | null {
    if (!point) return null;
    const rook = this.quarry.position;
    const { throwMinM, throwMaxM, throwScatterM, throwHandAboveEyesM, throwAngleMaxDeg, throwAngleMinDeg, throwSpeedMaxMps, throwLandToleranceM } =
      enemyGrenadeConfig;
    const fromRookM = Math.hypot(point.xM - rook.x, point.zM - rook.z);
    if (fromRookM < throwMinM || fromRookM > throwMaxM) return null;
    const scatterRad = this.random() * 2 * Math.PI;
    const scatterM = Math.sqrt(this.random()) * throwScatterM; // evenly over the disc, not bunched at the centre
    this.lobTarget.set(rook.x + Math.cos(scatterRad) * scatterM, rook.y + lobLandLiftM, rook.z + Math.sin(scatterRad) * scatterM);
    for (const way of peekWays(point)) {
      peekEyesAt(point, way, this.lobFrom);
      this.lobFrom.y += throwHandAboveEyesM;
      for (let i = 0; i < throwAngleTries; i++) {
        const angleDeg = throwAngleMaxDeg - ((throwAngleMaxDeg - throwAngleMinDeg) * i) / (throwAngleTries - 1);
        if (!lobVelocity(this.lobFrom, this.lobTarget, angleDeg * (Math.PI / 180), grenadeConfig.gravityMps2, this.lobVelocity)) continue;
        if (this.lobVelocity.length() > throwSpeedMaxMps) continue;
        if (!lobIsClear(this.lobFrom, this.lobVelocity, this.lobTarget, grenadeConfig.gravityMps2, this.collision, throwLandToleranceM)) continue;
        return { way, from: this.lobFrom.clone(), velocity: this.lobVelocity.clone(), rookAt: rook.clone(), cost: fromRookM };
      }
    }
    return null;
  }

  throwStillOn(_enemy: StandInEnemy, plan: ThrowPlan): boolean {
    const rook = this.quarry.position;
    return Math.hypot(rook.x - plan.rookAt.x, rook.z - plan.rookAt.z) <= enemyGrenadeConfig.throwCancelMovedM;
  }

  throwGrenade(_enemy: StandInEnemy, plan: ThrowPlan): void {
    this.launchGrenade(plan.from, plan.velocity);
  }

  throwOver(enemy: StandInEnemy, thrown: boolean): void {
    this.squad.grenadeOver(enemy, thrown);
  }

  /**
   * The best flank spot for this stand-in, or null (enemies.md, "Choosing cover", 4.7). A spot qualifies if it is free
   * (and not the one it holds), at least the flank angle round from where Rook looks, hides it from him (by its own prop),
   * lets a peek from it see him (his cover does not protect that side), is out of a live grenade's blast, and has a route
   * with at most the allowed metres in his view. Among those: the least exposed route, then the shortest. With `side` (1
   * or -1, see `flankSide`), only spots on that side of him: a pincer's second flank (4.11).
   */
  planFlank(enemy: StandInEnemy, side = 0): FlankPlan | null {
    const { position, eyes, forward } = this.quarry;
    const lookM = Math.hypot(forward.x, forward.z);
    const minCos = Math.cos(squadConfig.flankMinAngleDeg * (Math.PI / 180));
    const rejects = this.flankRejects;
    for (const key of Object.keys(rejects) as (keyof FlankRejects)[]) rejects[key] = 0;
    let best: FlankPlan | null = null;
    for (const point of this.coverPoints.points) {
      const holder = this.coverPoints.claimedBy(point);
      if (point === enemy.cover || (holder && holder !== enemy)) {
        rejects.taken++;
        continue;
      }
      const toX = point.xM - position.x;
      const toZ = point.zM - position.z;
      const toM = Math.hypot(toX, toZ);
      if (lookM > 1e-6 && toM > 1e-6 && (forward.x * toX + forward.z * toZ) / (lookM * toM) > minCos) {
        rejects.inFront++;
        continue;
      }
      if (side !== 0 && this.flankSide(point) !== side) {
        rejects.sameSide++;
        continue;
      }
      if (!this.coverPoints.hides(point, eyes)) {
        rejects.notHidden++;
        continue;
      }
      if (!peekWays(point).some((way) => this.seesPlayerFrom(peekEyesAt(point, way, this.peekEyes)))) {
        rejects.peekBlocked++;
        continue;
      }
      this.spot.set(point.xM, 0, point.zM);
      if (this.grenadeNear(this.spot, grenadeConfig.blastRadiusM + standInConfig.grenadeMarginM)) {
        rejects.nearGrenade++;
        continue;
      }
      const route = this.routeToCover;
      if (!this.navigation.findPath(enemy.feet, this.spot, route) || route[route.length - 1].distanceTo(this.spot) > standInConfig.coverArriveM) {
        rejects.noRoute++;
        continue;
      }
      const exposedM = this.exposedRouteM(route);
      if (exposedM > squadConfig.flankMaxExposedM) {
        rejects.routeSeen++;
        continue;
      }
      let lengthM = 0;
      for (let i = 1; i < route.length; i++) lengthM += route[i - 1].distanceTo(route[i]);
      const cost = exposedM * exposedCostPerM + lengthM;
      if (!best || cost < best.cost) best = { point, cost };
    }
    return best;
  }

  /** Which side of Rook a spot is on, as he looks: 1 or -1 (right or left; straight ahead or behind counts as 1). */
  flankSide(point: CoverPoint): number {
    const { position, forward } = this.quarry;
    return forward.z * (point.xM - position.x) - forward.x * (point.zM - position.z) >= 0 ? -1 : 1;
  }

  /** How many metres of a route Rook can see a standing body's head on (judged as `viewEyes`), checked every metre or so. */
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
        if (this.clearLine(this.viewEyes, this.sample)) exposedM += lengthM / steps;
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
    // A route starts at the floor nearest its feet and ends within the arrive distance of the spot, so it is never
    // shorter than the straight line between those, minus that distance: the most promising spots get checked first (4.13b).
    const onFloor = this.navigation.closestPoint(enemy.feet, this.routeStart);
    return this.coverPoints.best(
      enemy,
      this.viewEyes,
      this.viewFeet,
      (point) => this.walkM(enemy, point),
      enemy.values,
      (point) => this.canFightFrom(point), // a spot it can shoot from is preferred (decision 237)
      (point) => (onFloor ? Math.max(this.routeStart.distanceTo(this.spotOnFloor.set(point.xM, 0, point.zM)) - standInConfig.coverArriveM, 0) : 0),
    );
  }

  pickNearestCover(enemy: StandInEnemy): CoverPoint | null {
    let best: CoverPoint | null = null;
    let bestWalkM = Infinity;
    for (const point of this.coverPoints.points) {
      const holder = this.coverPoints.claimedBy(point);
      if (point === enemy.cover || (holder && holder !== enemy)) continue;
      if (!this.coverPoints.hides(point, this.viewEyes)) continue;
      const walk = this.walkM(enemy, point); // Infinity if unreachable or near a live grenade
      if (walk < bestWalkM) {
        best = point;
        bestWalkM = walk;
      }
    }
    if (best) this.coverPoints.claim(best, enemy);
    else this.coverPoints.release(enemy);
    return best;
  }

  coverHides(point: CoverPoint): boolean {
    return this.coverPoints.hides(point, this.viewEyes);
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
      const hides = this.coverPoints.hides(point, this.viewEyes);
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
    this.aimAt(enemy, shot, this.muzzle, this.aim);
    // Suppressing fire at one edge of his cover pins that side for a moment (the exposure meter hears of it).
    if (shot === 'suppress') this.events.emit('cover:pinned', { anchor: enemy.lastKnown, side: this.pinSide });
    let onSurface = false;
    if (shot === 'hit') {
      this.end.copy(this.aim);
      this.damagePlayer(enemyGunConfig[enemy.gun].damagePerHit, this.muzzle); // the gun decides the damage (4.12)
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
