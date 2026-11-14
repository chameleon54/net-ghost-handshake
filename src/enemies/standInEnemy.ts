import { Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { grenadeConfig } from '../config/grenade';
import { squadConfig } from '../config/squad';
import { standInConfig } from '../config/standInEnemy';
import type { CoverPoint } from '../level/cover';
import { hearsNoise, type Noise, type NoiseKind } from '../stealth/noise';
import type { HitZone } from './dummy';
import { Health } from './health';
import type { Target } from './target';

/**
 * `approach`: walking (to its cover, or straight for Rook when no cover hides it). `cover`: at its cover spot, holding.
 * `fight`: standing where it is, firing at Rook (he is close, or its cover failed). `retreat`: backing off to new cover
 * while firing. `shoot`: standing in the open firing, only when no cover hides it (the 4.1 behaviour). `flee`: running
 * out of a grenade's blast, not firing.
 */
export type StandInState = 'idle' | 'approach' | 'cover' | 'fight' | 'retreat' | 'shoot' | 'flee' | 'falling' | 'down';

/** A round's outcome, decided when it is fired: it hits Rook, misses near him, or is fired at his cover while he is hidden. */
export type StandInShot = 'hit' | 'miss' | 'cover';

/** Where a peek from cover is: holding, the tell, coming out, firing, going back in (4.4). */
type PeekPhase = 'hold' | 'tell' | 'out' | 'fire' | 'back';

/** How the stand-in touches the world. The game gives it real rays, navigation and cover; tests give it fakes. */
export interface StandInHooks {
  /** True if nothing solid is between its eyes and Rook. */
  canSeePlayer(enemy: StandInEnemy): boolean;
  /** Pushes its feet out of walls and props, so it slides along them. Changes `feet`. */
  pushOut(feet: Vector3): void;
  /** A walkable route from `from` to `to`, written into `out` (the first point is the start). Leaves `out` empty if there is none. */
  findPath(from: Vector3, to: Vector3, out: Vector3[]): boolean;
  /** One round leaves its gun, with its outcome already decided (at the moment of firing). */
  fire(enemy: StandInEnemy, shot: StandInShot): void;
  /** True if Rook can be seen from eyes at `eyes` (used to pick the side a peek steps out to). */
  seesPlayerFrom(eyes: Vector3): boolean;
  /** It is about to peek out: the tell's sound plays from where it is. */
  peekTell(enemy: StandInEnemy): void;
  /** The best free cover spot that hides it from Rook, claimed for it (its old one let go), or null if none hides it. */
  pickCover(enemy: StandInEnemy): CoverPoint | null;
  /** True if this spot still hides a body from Rook where he is now. */
  coverHides(point: CoverPoint): boolean;
  /** Lets go of the spot it holds. */
  releaseCover(enemy: StandInEnemy): void;
  /** The nearest live grenade it can see within `radiusM` of its feet, written into `out`. False if there is none. */
  spotGrenade(enemy: StandInEnemy, radiusM: number, out: Vector3): boolean;
  /** True if any live grenade is within `radiusM` of `point` (seen or not). */
  grenadeNear(point: Vector3, radiusM: number): boolean;
  /**
   * Where to run from a grenade at `grenade`: the best cover point out of the blast that it can reach quickly (claimed for
   * it, and returned), or else a spot of open floor straight away from the grenade (null returned). The spot goes into `out`.
   */
  planFlee(enemy: StandInEnemy, grenade: Vector3, safeM: number, out: Vector3): CoverPoint | null;
  /** It saw a grenade and runs: for the callout (phase 6). */
  grenadeSpotted(enemy: StandInEnemy): void;
  /** The chance a round aimed at Rook hits right now, from his exposure meter (4.5). The hit budget is applied on top. */
  hitChance(enemy: StandInEnemy): number;
  /** True if Rook can see it right now: it is on his screen and nothing blocks the view (for the first-contact rule). */
  rookSees(enemy: StandInEnemy): boolean;
  /** Asks the squad coordinator for a firing slot (4.6): true if it holds one now. */
  requestSlot(enemy: StandInEnemy): boolean;
  /** Gives its firing slot back. */
  releaseSlot(enemy: StandInEnemy): void;
  /** True if the squad's hit budget lets a round hit Rook now. */
  mayHit(): boolean;
  /** A round hit Rook: the squad's hit budget is spent for a while. */
  hitLanded(): void;
}

const degToRad = Math.PI / 180;
/** Getting this much closer to a walk's goal counts as progress (smaller changes are jitter). */
const progressStepM = 0.05;
/** Noises made where Rook's bullet or grenade ended up, not where he is. */
const awayFromRook: ReadonlySet<NoiseKind> = new Set<NoiseKind>(['impact', 'grenade-bounce', 'grenade-blast']);

// A temporary enemy (milestone 4.1, decision 197), growing step by step into the real one. It starts idle, wakes on a
// noise it hears or a hit, and from then on always knows where Rook is. It follows routes on the navigation mesh (4.2).
// Since 4.3 it goes to the best cover that hides it from Rook and holds there, crouched behind low cover. Since 4.4 it
// peeks from there every few seconds: a tell (a small movement and a sound), then it rises over low cover or steps past
// the edge of high cover, fires a burst, and goes back in; a peek that finds Rook hidden may fire at his cover anyway. It
// does not run from a fight (decisions 209 and 210): seen up close, it stands and fires, then backs off to new cover still
// firing; if its cover fails at range it answers with a burst before moving. Wounded, it stops standing its ground and
// pulls back into cover, peeking less; it runs out of the blast of a grenade it sees (decision 214). If no cover hides
// it, it falls back to heading for Rook and firing when it sees him. Since 4.5 its hit chance comes from Rook's exposure
// meter, and before first contact (he has not seen it) its first burst always misses, as a warning. Since 4.6 it is one of
// a squad: it fires only while it holds a firing slot, and the squad shares the hit budget. No drawing code here.
export class StandInEnemy implements Target {
  /** Where its feet are. It stays on the floor. */
  readonly feet = new Vector3();
  /** Which way it faces; 0 faces north (-z), like the player's yaw. */
  yawRad = 0;
  health = new Health(standInConfig.healthPoints);
  state: StandInState = 'idle';
  /** True while it crouches behind low cover. */
  crouched = false;
  /** Dev panel testing aid: stands still and holds fire (it can still be shot and fall). */
  frozen = false;
  /** Where it last knew Rook was (his feet): where it last saw him, or last heard him (decision 213). */
  readonly lastKnown = new Vector3();
  /** False until it has seen or heard him since it (re)spawned. */
  knowsWhere = false;
  /** How long ago it last saw or heard him. */
  lastKnownAgeSec = Infinity;
  private stateSec = 0;
  private seesPlayer = false;
  private sightTimerSec = 0;
  /** True once it has started a firing run at Rook (the reaction pause has begun). */
  private engaged = false;
  /** Time until the next round may fire (the reaction pause, then the gaps within and between bursts). */
  private cooldownSec = 0;
  private roundsInBurst = 0;
  /** Bursts finished since the current fight began. */
  private burstsDone = 0;
  /** In a fight, when it may next look for cover again after finding none. */
  private coverRetryAtSec = 0;
  /** True from seeing a grenade until it reacts. */
  private grenadeSeen = false;
  private grenadeReactSec = 0;
  private readonly grenadeAt = new Vector3();
  private readonly fleeSpot = new Vector3();
  /** True while it holds one of the squad's firing slots (4.6). */
  private hasSlot = false;
  /**
   * First contact (4.5): false until Rook has seen it or it has fired its warning burst. Until then every round misses.
   * Once per life.
   */
  private contacted = false;
  private readonly ears = new Vector3();
  private readonly path: Vector3[] = [];
  /** The point of `path` it is walking to. */
  private pathIndex = 0;
  private repathTimerSec = 0;
  /** Whether the last route planned reached anywhere. */
  private routeFound = true;
  /** The current walk's goal, the closest it has got to it, and how long it has gone without getting closer. */
  private readonly walkGoal = new Vector3(Infinity, 0, Infinity);
  private walkClosestM = Infinity;
  private walkStuckForSec = 0;
  private coverPoint: CoverPoint | null = null;
  /** Whether its spot hid it from Rook at the last cover check. */
  private spotHides = false;
  private coverTimerSec = 0;
  private readonly coverSpot = new Vector3();
  private peekPhase: PeekPhase = 'hold';
  private peekTimerSec = 0;
  /** How far out it is: 0 hidden at its spot, 1 fully out. */
  private peekShare = 0;
  /** How far it has risen out of a crouch for this peek (only when the peek rises over low cover). */
  private riseShare = 0;
  /** The way a peek steps (a unit vector across the cover), or zero when it rises over low cover instead. */
  private readonly peekSide = new Vector3();
  /** What this peek does once out: fire at Rook, fire at his cover, or just look. */
  private peekMode: 'aimed' | 'cover' | 'look' = 'look';
  private peekRounds = 0;
  private readonly peekEyes = new Vector3();

  constructor(
    private readonly spawn: { readonly xM: number; readonly zM: number; readonly yawRad: number },
    private readonly hooks: StandInHooks,
    private readonly random: () => number = Math.random,
  ) {
    this.placeAtSpawn();
  }

  get xM(): number {
    return this.feet.x;
  }

  get zM(): number {
    return this.feet.z;
  }

  get heightM(): number {
    return this.crouchedOr(standInConfig.crouchHeightM, dummyConfig.heightM);
  }

  get eyeHeightNowM(): number {
    return this.crouchedOr(standInConfig.crouchEyeHeightM, standInConfig.eyeHeightM);
  }

  get muzzleHeightNowM(): number {
    return this.crouchedOr(standInConfig.crouchMuzzleHeightM, standInConfig.muzzleHeightM);
  }

  /** How far out of its cover it is during a peek: 0 hidden, 1 fully out. */
  get peekOut(): number {
    return this.peekShare;
  }

  /** A crouched value, or the standing one; crouched behind low cover, a rising peek goes from one to the other. */
  private crouchedOr(crouchedValue: number, standingValue: number): number {
    if (!this.crouched) return standingValue;
    return crouchedValue + (standingValue - crouchedValue) * this.riseShare;
  }

  /** True while what it knows of Rook is fresh enough to fire at his cover. */
  get knowsFresh(): boolean {
    return this.knowsWhere && this.lastKnownAgeSec <= standInConfig.memoryFreshSec;
  }

  /** The cover spot it holds or is walking to, or null. */
  get cover(): CoverPoint | null {
    return this.coverPoint;
  }

  /** Below its wounded share of health: it stops standing its ground (decision 214). */
  get wounded(): boolean {
    return this.health.current < this.health.max * standInConfig.woundedHealthShare;
  }

  /** How close a grenade must be for it to run: the blast radius plus a margin. */
  private get grenadeDangerM(): number {
    return grenadeConfig.blastRadiusM + standInConfig.grenadeMarginM;
  }

  get hittable(): boolean {
    return this.state !== 'falling' && this.state !== 'down';
  }

  get awake(): boolean {
    return this.state !== 'idle' && this.state !== 'falling' && this.state !== 'down';
  }

  /** The part of its route still ahead (from where it stands), for the dev overlay. Empty when it is not walking. */
  routeAhead(out: Vector3[]): Vector3[] {
    out.length = 0;
    if (this.state !== 'approach' && this.state !== 'retreat' && this.state !== 'flee') return out;
    out.push(this.feet);
    for (let i = this.pathIndex; i < this.path.length; i++) out.push(this.path[i]);
    return out;
  }

  /** 0 when standing, 1 when flat. Drives the tip-over drawing. */
  get fallProgress(): number {
    if (this.state === 'down') return 1;
    if (this.state !== 'falling') return 0;
    return Math.min(this.stateSec / standInConfig.fallTimeSec, 1);
  }

  /** Back at its spawn spot, idle, at full health (instant restart, and the dev panel's Respawn). */
  reset(): void {
    this.placeAtSpawn();
    this.setState('idle');
  }

  /**
   * A noise Rook caused: if it carries to its ears, it wakes up if it was idle. A noise made where he is (a shot, a step)
   * also tells it where he was; one made where his bullet or grenade landed does not (decision 219).
   */
  hear(noise: Noise): void {
    if (this.state === 'falling' || this.state === 'down') return;
    this.ears.set(this.feet.x, this.eyeHeightNowM, this.feet.z);
    if (!hearsNoise(noise, this.ears)) return;
    if (!awayFromRook.has(noise.kind)) {
      this.lastKnown.set(noise.position.x, 0, noise.position.z);
      this.knowsWhere = true;
      this.lastKnownAgeSec = 0;
    }
    if (this.state === 'idle') this.wake();
  }

  hit(zone: HitZone, bodyDamage: number): boolean {
    if (!this.hittable) return false;
    if (zone === 'head') return this.kill();
    const killed = this.health.damage(bodyDamage);
    if (killed) this.die();
    else if (this.state === 'idle') this.wake();
    return killed;
  }

  kill(): boolean {
    if (!this.hittable) return false;
    const killed = this.health.kill();
    if (killed) this.die();
    return killed;
  }

  isBehind(xM: number, zM: number): boolean {
    const facingX = -Math.sin(this.yawRad);
    const facingZ = -Math.cos(this.yawRad);
    return facingX * (xM - this.feet.x) + facingZ * (zM - this.feet.z) < 0;
  }

  /** Once per game update, after the player has moved. `player` is Rook's feet. */
  update(dtSec: number, player: Vector3): void {
    this.think(dtSec, player);
    if (this.hasSlot && !this.inBurst) this.giveSlotBack(); // a slot covers one burst, and goes back whatever ended it
  }

  /** True during a burst: firing one, or peeking out to fire one (from the tell until it starts back in). */
  private get inBurst(): boolean {
    if (!this.awake || this.frozen) return false;
    const peeking = this.state === 'cover' && (this.peekPhase === 'tell' || this.peekPhase === 'out' || this.peekPhase === 'fire');
    return peeking || (this.engaged && this.roundsInBurst > 0);
  }

  /** Asks for a firing slot if it holds none. True if it holds one now. */
  private takeSlot(): boolean {
    if (!this.hasSlot) this.hasSlot = this.hooks.requestSlot(this);
    return this.hasSlot;
  }

  private giveSlotBack(): void {
    if (!this.hasSlot) return;
    this.hooks.releaseSlot(this);
    this.hasSlot = false;
  }

  private think(dtSec: number, player: Vector3): void {
    this.stateSec += dtSec;
    if (this.state === 'falling') {
      if (this.stateSec >= standInConfig.fallTimeSec) this.setState('down');
      return;
    }
    if (this.state === 'down') {
      if (this.stateSec >= standInConfig.respawnDelaySec) {
        this.placeAtSpawn();
        this.wake(); // decision 201: it gets up awake
      }
      return;
    }
    if (this.state === 'idle' || this.frozen) return;

    this.sightTimerSec -= dtSec;
    if (this.sightTimerSec <= 0) {
      this.seesPlayer = this.hooks.canSeePlayer(this);
      this.sightTimerSec = 1 / standInConfig.sightChecksPerSec;
      if (!this.contacted && this.hooks.rookSees(this)) this.contacted = true;
      // It looks for grenades as often as it looks for Rook.
      if (!this.grenadeSeen && this.state !== 'flee' && this.hooks.spotGrenade(this, this.grenadeDangerM, this.grenadeAt)) {
        this.grenadeSeen = true;
        this.grenadeReactSec = standInConfig.grenadeReactionSec;
      }
    }
    // Seeing him tells it where he is. Woken by a hit, or just up again, it starts from where he is too.
    this.lastKnownAgeSec += dtSec;
    if (this.seesPlayer || !this.knowsWhere) {
      this.lastKnown.set(player.x, 0, player.z);
      this.knowsWhere = true;
      this.lastKnownAgeSec = 0;
    }
    // A grenade it saw beats everything else, once it has reacted (decision 214).
    if (this.grenadeSeen) {
      this.grenadeReactSec -= dtSec;
      if (this.grenadeReactSec <= 0) this.startFlee();
    }
    if (this.state === 'flee') {
      this.flee(dtSec);
      return;
    }
    this.checkCover(dtSec);
    const dx = player.x - this.feet.x;
    const dz = player.z - this.feet.z;
    const distanceM = Math.hypot(dx, dz);

    if (this.state === 'fight') {
      this.fight(dtSec, dx, dz, distanceM);
      return;
    }
    if (this.state === 'retreat') {
      this.retreat(dtSec, dx, dz);
      return;
    }
    // Seen up close, it stands and fights instead of running (decision 209); wounded, that fight is only to get away.
    // Not while its cover still works: then a peek that sees Rook fires from the peek and goes back in (decision 218).
    const coverWorks = this.state === 'cover' && this.spotHides;
    if (this.coverPoint && this.seesPlayer && distanceM <= standInConfig.standGroundM && !coverWorks) {
      this.beginFight();
      this.fight(dtSec, dx, dz, distanceM);
      return;
    }

    if (this.coverPoint) {
      // Once it holds a spot it stays holding (a peek moves it off the spot and back) until it picks another.
      const toCoverM = Math.hypot(this.coverSpot.x - this.feet.x, this.coverSpot.z - this.feet.z);
      if (this.state !== 'cover' && toCoverM > standInConfig.coverArriveM) {
        this.startWalking();
        if (!this.walkRoute(dtSec, this.coverSpot)) this.giveUpWalk(); // drop the spot; pick again straight away
        return;
      }
      // At its spot: crouch behind low cover, hold, and peek out every so often.
      this.setState('cover');
      this.crouched = this.coverPoint.height === 'low';
      this.holdAndPeek(dtSec, this.coverPoint, dx, dz);
      return;
    }

    // No cover hides it: the 4.1 behaviour. Head for Rook, and stop to fire once it sees him within range.
    if (this.seesPlayer && distanceM <= standInConfig.stopRangeM) {
      this.setState('shoot');
      this.engage(dtSec, dx, dz);
      return;
    }
    this.startWalking();
    if (distanceM > standInConfig.closestM) this.walkRoute(dtSec, player); // if no route, it keeps trying
  }

  /**
   * Every so often: if it has no cover, or its spot no longer hides it, it picks the best spot (maybe none). If its spot
   * fails while it can see Rook, it answers with a fight first instead of walking off (decision 209).
   */
  private checkCover(dtSec: number): void {
    if (this.state === 'fight' || this.state === 'retreat' || this.state === 'flee') return; // those pick their own next spot
    this.coverTimerSec -= dtSec;
    if (this.coverTimerSec > 0) return;
    this.coverTimerSec = standInConfig.coverCheckIntervalSec;
    this.spotHides = this.coverPoint !== null && this.hooks.coverHides(this.coverPoint);
    if (this.spotHides) return; // it stays while its spot works
    if (this.state === 'cover' && this.seesPlayer) {
      this.beginFight();
      return;
    }
    const next = this.hooks.pickCover(this);
    if (next === this.coverPoint) return;
    this.setCover(next);
    if (this.state === 'cover') this.startWalking(); // off to the new spot
  }

  private setCover(next: CoverPoint | null): void {
    this.coverPoint = next;
    this.spotHides = next !== null; // a picked spot hides it (that is how it was picked)
    if (next) this.coverSpot.set(next.xM, 0, next.zM);
    this.repathTimerSec = 0; // a fresh route to the new spot
  }

  /** Stands up where it is to fight. */
  private beginFight(): void {
    this.setState('fight');
    this.crouched = false;
    this.burstsDone = 0;
    this.coverRetryAtSec = 0;
  }

  /**
   * Fights where it stands. It always finishes a burst, and fires at least one. Then, if Rook is close, it keeps on for
   * the fight time and backs off to new cover still firing; if he is further away, it walks to new cover. Wounded, it
   * backs off as soon as its burst is done, without answering first or waiting (decision 214). With nowhere to go, it
   * keeps fighting. If it loses sight of him it stops and finds cover.
   */
  private fight(dtSec: number, dx: number, dz: number, distanceM: number): void {
    if (!this.seesPlayer) {
      this.leaveFight();
      return;
    }
    this.engage(dtSec, dx, dz);
    if (this.roundsInBurst !== 0) return; // never leaves mid-burst
    const close = distanceM <= standInConfig.standGroundM;
    if (!this.wounded) {
      if (this.burstsDone === 0) return; // it always answers
      if (close && this.stateSec < standInConfig.fightSec) return;
    }
    if (this.stateSec < this.coverRetryAtSec) return;
    const next = this.hooks.pickCover(this);
    this.setCover(next);
    if (!next) {
      // Nowhere to go: fight on, answer again, and look again a little later.
      this.coverRetryAtSec = this.stateSec + Math.max(standInConfig.fightSec, standInConfig.coverCheckIntervalSec);
      this.burstsDone = 0;
      return;
    }
    if (close || this.wounded) this.setState('retreat');
    else this.startWalking();
  }

  /** Runs from the grenade it saw: picks where to, says so, and goes. */
  private startFlee(): void {
    this.grenadeSeen = false;
    this.hooks.grenadeSpotted(this);
    const point = this.hooks.planFlee(this, this.grenadeAt, this.grenadeDangerM, this.fleeSpot);
    this.coverPoint = point;
    this.spotHides = false; // a flee spot may not hide it; it checks once it is there
    if (point) this.coverSpot.set(point.xM, 0, point.zM);
    this.crouched = false;
    this.engaged = false;
    this.setState('flee');
    this.repathTimerSec = 0;
  }

  /**
   * Runs to its flee spot without firing, then waits there until no live grenade threatens it. A grenade that still
   * does (it rolled after it) and that it can see sends it running again. Then it carries on as usual.
   */
  private flee(dtSec: number): void {
    const toSpotM = Math.hypot(this.fleeSpot.x - this.feet.x, this.fleeSpot.z - this.feet.z);
    if (toSpotM > standInConfig.coverArriveM) {
      if (!this.walkRoute(dtSec, this.fleeSpot, standInConfig.grenadeRunSpeedMps)) this.giveUpWalk(); // carry on as usual
      return;
    }
    if (this.hooks.grenadeNear(this.feet, this.grenadeDangerM)) {
      if (this.hooks.spotGrenade(this, this.grenadeDangerM, this.grenadeAt)) this.startFlee();
      return;
    }
    this.coverTimerSec = 0; // safe: check its cover straight away
    if (this.coverPoint) this.setState('cover');
    else this.startWalking();
  }

  /** Backs off to its new cover, slower, facing Rook and firing while it can see him (decision 210). */
  private retreat(dtSec: number, dx: number, dz: number): void {
    if (!this.coverPoint) {
      this.leaveFight();
      return;
    }
    const toCoverM = Math.hypot(this.coverSpot.x - this.feet.x, this.coverSpot.z - this.feet.z);
    if (toCoverM <= standInConfig.coverArriveM) {
      this.setState('cover'); // holds from the next update
      return;
    }
    const firing = this.seesPlayer;
    if (!this.walkRoute(dtSec, this.coverSpot, standInConfig.walkSpeedMps * standInConfig.retreatSpeedShare, !firing)) {
      this.giveUpWalk(); // stop backing off and check its cover
      return;
    }
    if (firing) this.engage(dtSec, dx, dz, standInConfig.retreatHitChanceShare);
    else this.engaged = false;
  }

  /**
   * A walk failed (no route, or stuck): it lets go of the spot it was going to and looks for cover again straight away.
   * A live grenade's blast is never picked, so after a failed grenade escape this is "carry on as usual" (decision 219).
   */
  private giveUpWalk(): void {
    this.leaveCover();
    this.coverTimerSec = 0;
    this.startWalking();
  }

  /** Out of the fight (it lost sight of Rook): find cover again straight away. */
  private leaveFight(): void {
    this.coverTimerSec = 0;
    this.startWalking();
  }

  /**
   * At its cover spot. It holds, facing the cover (firing if it can see Rook from here), then peeks: the tell, out, a
   * burst, back in (4.4). Its body moves with the peek, so its hit zones go out and come back with it.
   */
  private holdAndPeek(dtSec: number, point: CoverPoint, dx: number, dz: number): void {
    if (this.peekPhase === 'hold') {
      if (this.seesPlayer) {
        this.engage(dtSec, dx, dz);
        return;
      }
      this.engaged = false;
      this.faceLastKnown(dtSec); // it watches where Rook was, never turning its back on him (decision 213)
      this.peekTimerSec -= dtSec;
      if (this.peekTimerSec > 0) return;
      // A peek is a burst: it needs a firing slot from the tell on. With none free it stays in and asks again shortly.
      if (this.takeSlot()) this.startTell(point);
      else this.peekTimerSec = squadConfig.slotRetrySec;
      return;
    }
    this.peekTimerSec -= dtSec;
    if (this.peekPhase === 'fire') {
      this.peekFire(dtSec, dx, dz);
      return;
    }
    this.faceLastKnown(dtSec); // it comes out facing where Rook was
    if (this.peekPhase === 'tell') {
      this.setPeekShare(point, standInConfig.tellShare * progressOf(this.peekTimerSec, standInConfig.tellSec));
      if (this.peekTimerSec <= 0) {
        this.peekPhase = 'out';
        this.peekTimerSec = standInConfig.peekOutSec;
      }
    } else if (this.peekPhase === 'out') {
      const share = progressOf(this.peekTimerSec, standInConfig.peekOutSec);
      this.setPeekShare(point, standInConfig.tellShare + (1 - standInConfig.tellShare) * share);
      if (this.peekTimerSec <= 0) this.startPeekFire();
    } else {
      this.setPeekShare(point, 1 - progressOf(this.peekTimerSec, standInConfig.peekBackSec));
      if (this.peekTimerSec <= 0) this.resetPeek();
    }
  }

  /**
   * The tell: picks how to come out, warns with a sound, and starts to move. Low cover offers rising over the top (0) and
   * its open sides; high cover its open sides only (1 is right, -1 left, as seen facing the cover). It picks at random
   * among the ways that let it see Rook, or among all of them if none does (decision 216).
   */
  private startTell(point: CoverPoint): void {
    const low = point.height === 'low';
    const ways = low ? [0] : [];
    if (point.lean === 'right' || point.lean === 'both') ways.push(1);
    if (point.lean === 'left' || point.lean === 'both') ways.push(-1);
    if (ways.length === 0) ways.push(1); // a high spot with no open side listed: it still steps out somewhere
    const rightX = Math.cos(point.facingYawRad); // the right-hand side when facing the cover
    const rightZ = -Math.sin(point.facingYawRad);
    const stepM = low ? standInConfig.crouchPeekStepM : standInConfig.peekStepM;
    const seeing = ways.filter((way) => {
      // Rising, its eyes are at standing height over the spot; stepping, at its height there, to the side.
      const eyeM = low && way !== 0 ? standInConfig.crouchEyeHeightM : standInConfig.eyeHeightM;
      this.peekEyes.set(this.coverSpot.x + way * rightX * stepM, eyeM, this.coverSpot.z + way * rightZ * stepM);
      return this.hooks.seesPlayerFrom(this.peekEyes);
    });
    const choices = seeing.length > 0 ? seeing : ways;
    const way = choices[Math.min(Math.floor(this.random() * choices.length), choices.length - 1)];
    this.peekSide.set(way * rightX, 0, way * rightZ);
    this.hooks.peekTell(this);
    this.peekPhase = 'tell';
    this.peekTimerSec = standInConfig.tellSec;
  }

  /** Fully out: it looks once, then fires at Rook if it sees him, at his cover by chance if not, or only looks. */
  private startPeekFire(): void {
    this.peekPhase = 'fire';
    this.seesPlayer = this.hooks.canSeePlayer(this);
    this.sightTimerSec = 1 / standInConfig.sightChecksPerSec;
    // Fire at his cover only on fresh knowledge of where he is (decision 216); old knowledge, it only looks.
    const fireAtCover = this.knowsFresh && this.random() < standInConfig.hiddenFireChance;
    this.peekMode = this.seesPlayer ? 'aimed' : fireAtCover ? 'cover' : 'look';
    this.peekRounds = 0;
    this.cooldownSec = 0; // the tell was the warning: no extra reaction pause
    this.peekTimerSec = standInConfig.burstRounds * standInConfig.roundIntervalSec; // how long a look lasts
  }

  /** Out of cover: fires one burst (or looks for as long as one would take), then goes back in. */
  private peekFire(dtSec: number, dx: number, dz: number): void {
    // It aims at Rook when it sees him; otherwise at where it last knew he was (decision 213).
    const facingErrorRad = this.peekMode === 'aimed' ? this.turnToward(dx, dz, dtSec) : this.faceLastKnown(dtSec);
    if (this.peekMode === 'look') {
      if (this.peekTimerSec <= 0) this.startPeekBack();
      return;
    }
    if (facingErrorRad > standInConfig.aimToleranceDeg * degToRad) return;
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    this.hooks.fire(this, this.peekMode === 'cover' ? 'cover' : this.aimedShot(1));
    this.peekRounds++;
    this.cooldownSec += standInConfig.roundIntervalSec;
    if (this.peekRounds >= standInConfig.burstRounds) {
      this.contacted = true; // a whole burst fired: the warning has been given
      this.startPeekBack();
    }
  }

  private startPeekBack(): void {
    this.peekPhase = 'back';
    this.peekTimerSec = standInConfig.peekBackSec;
  }

  /** Back to holding, for a random while. */
  private resetPeek(): void {
    this.peekPhase = 'hold';
    this.peekShare = 0;
    this.riseShare = 0;
    const { peekHoldMinSec, peekHoldMaxSec, woundedHoldScale } = standInConfig;
    const holdSec = peekHoldMinSec + this.random() * Math.max(peekHoldMaxSec - peekHoldMinSec, 0);
    this.peekTimerSec = holdSec * (this.wounded ? woundedHoldScale : 1); // wounded, it stays tucked in longer
  }

  /** How far out it is. Rising over low cover: it stands up. Stepping out: its feet move from the spot toward the open side. */
  private setPeekShare(point: CoverPoint, share: number): void {
    this.peekShare = share;
    const rising = this.peekSide.lengthSq() === 0;
    if (rising) {
      this.riseShare = share; // read through `crouchedOr`
      return;
    }
    const stepM = (point.height === 'low' ? standInConfig.crouchPeekStepM : standInConfig.peekStepM) * share;
    this.feet.x = this.coverSpot.x + this.peekSide.x * stepM;
    this.feet.z = this.coverSpot.z + this.peekSide.z * stepM;
  }

  /**
   * Turns to Rook and fires bursts, after the reaction pause the first time it sees him. `hitShare` scales the hit chance
   * (less while backing off).
   */
  private engage(dtSec: number, dx: number, dz: number, hitShare = 1): void {
    if (!this.engaged) {
      this.engaged = true;
      this.cooldownSec = standInConfig.reactionSec;
      this.roundsInBurst = 0;
    }
    // The reaction pause only counts down once it faces Rook, so it never fires sideways.
    const facingErrorRad = this.turnToward(dx, dz, dtSec);
    if (facingErrorRad <= standInConfig.aimToleranceDeg * degToRad) this.shoot(dtSec, hitShare);
  }

  /** Stands up and starts walking; it never fires on the move. */
  private startWalking(): void {
    this.crouched = false;
    this.engaged = false;
    if (this.state === 'approach') return;
    this.setState('approach');
    this.repathTimerSec = 0; // a fresh route from here
  }

  /**
   * Walks along its route toward `destination` at `speedMps`, planning a fresh one every so often. With `faceRoute` it
   * faces the way it goes; without, it keeps its facing (backing off while aiming at Rook). Returns false once the walk
   * has failed: no route was found, or it has not got closer to `destination` for a while (a route that stops short of
   * a spot it cannot reach ends that way too).
   */
  private walkRoute(dtSec: number, destination: Vector3, speedMps = standInConfig.walkSpeedMps, faceRoute = true): boolean {
    if (Math.hypot(destination.x - this.walkGoal.x, destination.z - this.walkGoal.z) > standInConfig.coverArriveM) {
      this.walkGoal.copy(destination); // a new goal: start counting afresh
      this.walkClosestM = Infinity;
      this.walkStuckForSec = 0;
    }
    this.repathTimerSec -= dtSec;
    if (this.repathTimerSec <= 0) {
      this.routeFound = this.hooks.findPath(this.feet, destination, this.path);
      this.pathIndex = 1; // the first point is where it stands
      this.repathTimerSec = standInConfig.repathIntervalSec;
    }
    if (faceRoute && this.pathIndex < this.path.length) {
      const next = this.path[this.pathIndex];
      this.turnToward(next.x - this.feet.x, next.z - this.feet.z, dtSec);
    }
    let stepM = speedMps * dtSec;
    while (stepM > 0 && this.pathIndex < this.path.length) {
      const next = this.path[this.pathIndex];
      const toX = next.x - this.feet.x;
      const toZ = next.z - this.feet.z;
      const toM = Math.hypot(toX, toZ);
      if (toM <= stepM) {
        this.feet.x = next.x;
        this.feet.z = next.z;
        stepM -= toM;
        this.pathIndex++;
      } else {
        this.feet.x += (toX / toM) * stepM;
        this.feet.z += (toZ / toM) * stepM;
        stepM = 0;
      }
    }
    this.hooks.pushOut(this.feet); // a safety net: the route already keeps clear of walls
    this.feet.y = 0;
    const toGoalM = Math.hypot(destination.x - this.feet.x, destination.z - this.feet.z);
    if (toGoalM < this.walkClosestM - progressStepM) {
      this.walkClosestM = toGoalM;
      this.walkStuckForSec = 0;
    } else {
      this.walkStuckForSec += dtSec;
    }
    return this.routeFound && this.walkStuckForSec < standInConfig.walkStuckSec;
  }

  /**
   * A round aimed at Rook: before first contact it always misses (a warning, enemies.md); after, it hits by the chance
   * from his exposure (times `hitShare`), within the hit budget.
   */
  private aimedShot(hitShare: number): StandInShot {
    if (!this.contacted) return 'miss';
    const hits = this.random() < this.hooks.hitChance(this) * hitShare && this.hooks.mayHit(); // the squad's hit budget
    if (hits) this.hooks.hitLanded();
    return hits ? 'hit' : 'miss';
  }

  private shoot(dtSec: number, hitShare: number): void {
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    if (!this.takeSlot()) {
      this.cooldownSec = 0; // all firing slots are busy: keep aiming and fire as soon as one is free
      return;
    }
    this.hooks.fire(this, this.aimedShot(hitShare));
    this.roundsInBurst++;
    if (this.roundsInBurst >= standInConfig.burstRounds) {
      this.contacted = true; // a whole burst fired: the warning has been given
      this.roundsInBurst = 0;
      this.burstsDone++;
      this.cooldownSec += standInConfig.burstPauseSec;
    } else {
      this.cooldownSec += standInConfig.roundIntervalSec;
    }
  }

  /** Turns toward where it last knew Rook was. Returns how far off it still faces, in radians. */
  private faceLastKnown(dtSec: number): number {
    return this.turnToward(this.lastKnown.x - this.feet.x, this.lastKnown.z - this.feet.z, dtSec);
  }

  /** Turns toward the direction (dx, dz) at its turn speed. Returns how far off it still faces, in radians. */
  private turnToward(dx: number, dz: number, dtSec: number): number {
    const wantedRad = Math.atan2(-dx, -dz); // yaw 0 faces -z
    let differenceRad = wantedRad - this.yawRad;
    differenceRad = Math.atan2(Math.sin(differenceRad), Math.cos(differenceRad)); // the short way round, -pi to pi
    const maxTurnRad = standInConfig.turnSpeedDegPerSec * degToRad * dtSec;
    const turnRad = Math.max(-maxTurnRad, Math.min(maxTurnRad, differenceRad));
    this.yawRad += turnRad;
    return Math.abs(differenceRad - turnRad);
  }

  private wake(): void {
    this.setState('approach');
    this.sightTimerSec = 0; // look straight away
    this.coverTimerSec = 0; // and pick cover straight away
    this.seesPlayer = false;
    this.repathTimerSec = 0;
  }

  private die(): void {
    this.setState('falling');
    this.leaveCover();
  }

  private leaveCover(): void {
    this.hooks.releaseCover(this);
    this.coverPoint = null;
  }

  private placeAtSpawn(): void {
    this.leaveCover();
    this.feet.set(this.spawn.xM, 0, this.spawn.zM);
    this.yawRad = this.spawn.yawRad;
    this.health = new Health(standInConfig.healthPoints);
    this.crouched = false;
    this.engaged = false;
    this.burstsDone = 0;
    this.knowsWhere = false;
    this.lastKnownAgeSec = Infinity;
    this.grenadeSeen = false;
    this.giveSlotBack();
    this.contacted = false;
    this.path.length = 0;
    this.pathIndex = 0;
  }

  private setState(state: StandInState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateSec = 0;
    this.walkGoal.set(Infinity, 0, Infinity); // a walk only counts within one state
    this.routeFound = true;
    this.resetPeek(); // a peek only lives inside one stay in cover
  }
}

/** How far through a timed step it is, 0 to 1, from the time left. A step of no length is done at once. */
function progressOf(timeLeftSec: number, totalSec: number): number {
  return totalSec > 0 ? 1 - Math.max(timeLeftSec, 0) / totalSec : 1;
}
