import { Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { enemyGrenadeConfig } from '../config/enemyGrenades';
import { enemyGunConfig, gunOfRole, type EnemyGun } from '../config/enemyGuns';
import { grenadeConfig } from '../config/grenade';
import { roleConfig, type Role, type RoleValues } from '../config/roles';
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
 * out of a grenade's blast, not firing. `flank`: sent by the squad round Rook's side to a cover spot, not firing (4.7).
 * `advance`: sent by the squad to closer cover under a squadmate's covering fire, not firing (4.9). `hunt`: sent by the
 * squad toward where it last knew Rook was, to cover near that spot (decision 235).
 */
export type StandInState = 'idle' | 'approach' | 'cover' | 'fight' | 'retreat' | 'shoot' | 'flee' | 'flank' | 'advance' | 'hunt' | 'falling' | 'down';

/**
 * A round's outcome, decided when it is fired: it hits Rook, misses near him, is fired at his cover while he is hidden,
 * or is suppressing fire at the edge of his cover (4.9).
 */
export type StandInShot = 'hit' | 'miss' | 'cover' | 'suppress';

/** Who covers a move between cover (4.17): the squad's suppressor, its own fire (the heavy), or nobody (a hidden route). */
export type MoveCover = 'squad' | 'self' | null;

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
  /** True if it stands on Rook's floor (the storey push, decision 277); left out, true. */
  onRookFloor?(enemy: StandInEnemy): boolean;
  /** True if this spot still hides a body from Rook where he is now. */
  coverHides(point: CoverPoint): boolean;
  /** Lets go of the spot it holds. */
  releaseCover(enemy: StandInEnemy): void;
  /**
   * The nearest free spot by walking (not its own) that hides it from Rook, claimed for it (its old one let go), or null
   * if none does: where it heads after a flinch on the move (decision 246).
   */
  pickNearestCover(enemy: StandInEnemy): CoverPoint | null;
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
  /** True if the squad's hit budget lets its round hit Rook now (only other enemies' hits hold it back, decision 270). */
  mayHit(enemy: StandInEnemy): boolean;
  /** A round hit Rook: the squad's hit budget is spent for a while. */
  hitLanded(enemy: StandInEnemy): void;
  /** Claims a cover spot for it (its old one let go): the flank spot the squad gave it. */
  claimCover(enemy: StandInEnemy, point: CoverPoint): void;
  /** Its flank is over (arrived, called off, or anything else): tells the squad. */
  flankOver(enemy: StandInEnemy): void;
  /** True while the squad is disorganised (its leader went down, 4.8): it holds longer between peeks. */
  disorganised(): boolean;
  /** False at an aggression tier with no suppressing fire (Cautious, 4.11): the heavy then fires on the move only when it sees Rook. */
  suppressionAllowed(): boolean;
  /** It went down (killed): tells the squad (a squad leader's death disorganises it). */
  downed(enemy: StandInEnemy): void;
  /** True while the squad wants it to keep pinning Rook's cover (the move it covers is on). */
  keepSuppressing(enemy: StandInEnemy): boolean;
  /** It stopped suppressing (for any reason): tells the squad. */
  suppressOver(enemy: StandInEnemy): void;
  /** Its advance is over (arrived, or anything else): tells the squad. */
  advanceOver(enemy: StandInEnemy): void;
  /** True if something solid is between a noise at `from` and its ears at `to` (the noise is muffled, 4.10). */
  noiseBlocked(from: Vector3, to: Vector3): boolean;
  /**
   * True if a round from the gun of a peek from `point` going `way` would get to Rook's cover: at edge `side` (1 or -1) of
   * where it last knew he was, or straight at it (0). Decision 239.
   */
  coverShotClear(enemy: StandInEnemy, point: CoverPoint, way: number, side: number): boolean;
  /** False if the round it is about to fire (aimed as `shot` aims) would strike its own cover near its muzzle. */
  muzzleClear(enemy: StandInEnemy, shot: StandInShot): boolean;
  /** True if a squadmate's body is in the line of the round it is about to fire (aimed as `shot` aims), 4.16. */
  friendInLine(enemy: StandInEnemy, shot: StandInShot): boolean;
  /** It began a reload (4.16): its sound and the `reloading` callout hook. */
  reloadStarted(enemy: StandInEnemy): void;
  /** It finished a reload. */
  reloadDone(enemy: StandInEnemy): void;
  /** True while the squad's covering fire for its move is live: a suppressor has the job and is not reloading (4.17). */
  coverLive(enemy: StandInEnemy): boolean;
  /** Where a push whose covering fire stopped holds (4.17): the nearest free cover near it that hides it, nearer than `goal`; or null. */
  pickHoldSpot(enemy: StandInEnemy, goal: CoverPoint | null): CoverPoint | null;
  /** It holds its push and calls for cover (4.17): the `need_cover` callout hook. */
  pushHeld(enemy: StandInEnemy): void;
  /** True while the squad hunts for Rook (decision 235); when it stops (he was found), a hunt move takes cover instead. */
  hunting(): boolean;
  /** Its hunt move is over (arrived, or anything else): tells the squad. */
  huntMoveOver(enemy: StandInEnemy): void;
  /** How many times as long it holds between peeks because of the hunt (the watcher less, a careful hold more). */
  huntHoldScale(enemy: StandInEnemy): number;
  /** At the moment of letting go (4.12): true if the throw is still on (Rook has not moved away since it was planned). */
  throwStillOn(enemy: StandInEnemy, plan: ThrowPlan): boolean;
  /** It lets go of its grenade as planned. */
  throwGrenade(enemy: StandInEnemy, plan: ThrowPlan): void;
  /** Its throw is over, `thrown` or not (called off, interrupted): tells the squad. */
  throwOver(enemy: StandInEnemy, thrown: boolean): void;
}

/**
 * A planned grenade throw (4.12): from which peek (`way`, see `peekWays`), where it leaves the hand, at what velocity,
 * where Rook was when it was planned (it is called off if he moves away), and its cost (the nearest thrower goes).
 */
export interface ThrowPlan {
  readonly way: number;
  readonly from: Vector3;
  readonly velocity: Vector3;
  readonly rookAt: Vector3;
  readonly cost: number;
}

/** The ways a peek from `point` can go: 0 rises over low cover; 1 and -1 step out right and left, as seen facing the cover. */
export function peekWays(point: CoverPoint): number[] {
  const ways = point.height === 'low' ? [0] : [];
  if (point.lean === 'right' || point.lean === 'both') ways.push(1);
  if (point.lean === 'left' || point.lean === 'both') ways.push(-1);
  if (ways.length === 0) ways.push(1); // a high spot with no open side listed: it still steps out somewhere
  return ways;
}

/** Where its eyes are when fully out of a peek from `point` going `way` (see `peekWays`). */
export function peekEyesAt(point: CoverPoint, way: number, out: Vector3): Vector3 {
  const low = point.height === 'low';
  const stepM = low ? standInConfig.crouchPeekStepM : standInConfig.peekStepM;
  // Rising, its eyes are at standing height over the spot; stepping, at its height there, to the side.
  const eyeM = low && way !== 0 ? standInConfig.crouchEyeHeightM : standInConfig.eyeHeightM;
  const rightX = Math.cos(point.facingYawRad); // the right-hand side when facing the cover
  const rightZ = -Math.sin(point.facingYawRad);
  return out.set(point.xM + way * rightX * stepM, (point.yM ?? 0) + eyeM, point.zM + way * rightZ * stepM);
}

/** Where its gun is (over its feet, at gun height) when fully out of a peek from `point` going `way`. */
export function peekGunAt(point: CoverPoint, way: number, out: Vector3): Vector3 {
  peekEyesAt(point, way, out);
  out.y = (point.yM ?? 0) + (point.height === 'low' && way !== 0 ? standInConfig.crouchMuzzleHeightM : standInConfig.muzzleHeightM);
  return out;
}

const degToRad = Math.PI / 180;
/** Getting this much closer to a walk's goal counts as progress (smaller changes are jitter). */
const progressStepM = 0.05;
/** A reload of 0 s still takes one moment (so a 0 on the dev panel cannot fire forever without reloading). */
const dtFloorSec = 0.01;
/** How many steps the carrot may take along the route in one update (a bound for very short route pieces). */
const carrotMaxMoves = 20;
/**
 * It plans its slowing down with this share of its braking, keeping the rest in hand, so it always makes the corner or
 * the stop (planning with all of it, it would run one step behind the plan all the way and arrive too fast).
 */
const brakePlanShare = 0.8;
/** How many corners ahead of the carrot it slows for. */
const cornersAhead = 4;
/**
 * The share of its speed it keeps through a turn of `turnRad`: all of it going straight, the configured share at a right
 * angle, falling to none for a full turn back (the creep speed still keeps it going).
 */
function cornerShare(turnRad: number): number {
  return Math.max(1 - (turnRad / (Math.PI / 2)) * (1 - standInConfig.cornerSpeedShareRightAngle), 0);
}
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
// a squad: it fires only while it holds a firing slot, and the squad shares the hit budget. Since 4.7 the squad may send
// it round Rook's side to flank him (the `flank` state). Since 4.8 it has a role (trooper, flanker, heavy or squad leader)
// whose values set its health, speeds, burst length and liked cover range. Since 4.9 the squad may have it pin Rook's
// cover (suppressing) or move up under that fire (`advance`), and Rook's near misses pin it back into cover. Since the
// hunt (4.11, decision 235) the squad may send it toward where it last knew Rook was (`hunt`). Since 4.12 (decision 249)
// its gun comes from its role, and a trooper or squad leader carries a grenade: the squad may have it lob it at Rook from
// a peek (the tell, a wind-up, the throw, back in). No drawing code here.
export class StandInEnemy implements Target {
  /** Where its feet are. It stays on the floor. */
  readonly feet = new Vector3();
  /** Which way it faces; 0 faces north (-z), like the player's yaw. */
  yawRad = 0;
  health = new Health(roleConfig.trooper.healthPoints); // its role's health, set when it spawns
  /** Its role (4.8): its body and gear, which never change. */
  readonly role: Role;
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
  /** Whether Rook could see it at the last sight check (on his screen, nothing in the way). */
  private rookSeesIt = false;
  /** On a flank: how long Rook has kept it in view. */
  private flankSpottedSec = 0;
  /**
   * The flank attack (decision 227): after a flank it peeks at once and stays out firing bursts (each with its own slot)
   * until Rook hurts it, it has not seen him for a moment, or the time is up. How long it has been out, and unseeing.
   */
  private pressing = false;
  /** On its way up (or down) to Rook's floor with no cover, sent by the squad's storey push (decision 277). */
  private climbing = false;
  private climbSec = 0;
  private pressSec = 0;
  private pressUnseenSec = 0;
  /** Suppressing (4.9): pinning the edge of Rook's cover for a squadmate, and which side of it (1 or -1). */
  private suppressing = false;
  private suppressSide = 1;
  /** Rook's fire came close while it was out (the Suppressed state): its next hold is longer. */
  private pinnedByRook = false;
  /**
   * Repositioning (decision 237): peeks from this spot, blind peeks in a row (it saw nothing), after how many peeks it
   * moves on (2 to 4, set on arriving), whether its last peek was blind, and whether it wants to move now.
   */
  private peeksHere = 0;
  private blindPeeks = 0;
  private repositionAfter = 3;
  private lastPeekBlind = false;
  private wantsMove = false;
  /** On a hunt move: true if it leads the hunt (it goes at its flank speed). */
  private huntLeads = false;
  /**
   * The flinch (decision 246): its own clock, the damage it took and when, the flinch time left, until when it cannot
   * flinch again, and whether it is heading for cover after a flinch (panic fire).
   */
  private clockSec = 0;
  private readonly recentHits: { atSec: number; damage: number }[] = [];
  private flinchLeftSec = 0;
  private flinchFreeAtSec = 0;
  private panicking = false;
  /** Grenades it carries (its role's count, from each spawn), and the throw the squad gave it, or null (4.12). */
  private grenadesLeft = 0;
  private throwPlan: ThrowPlan | null = null;
  /**
   * First contact (4.5): false until Rook has seen it or it has fired its warning burst. Until then every round misses.
   * Once per life.
   */
  private contacted = false;
  private readonly ears = new Vector3();
  private readonly path: Vector3[] = [];
  /** The next point of `path` its steering point (`carrot`) is heading for. */
  private pathIndex = 0;
  /**
   * Moving like a person (4.15, decision 265): a point that runs a little ahead along the route, which it steers at, so
   * corners become arcs; how fast it is going now (it speeds up and slows down); which way it is moving (a unit vector).
   */
  private readonly carrot = new Vector3();
  /**
   * Reloading (4.16, decision 266): rounds left in its magazine, how long its reload has left (0: not reloading), and
   * whether its magazine is empty and wants a reload as soon as it can.
   */
  private roundsLeft = 0;
  private reloadLeftSec = 0;
  private needsReload = false;
  /** Since when a squadmate has stood in its line of fire, or null (4.16). */
  private friendBlockedSinceSec: number | null = null;
  /**
   * Holding a push (4.17, decision 269): who covers its move; how long that cover has been gone; whether it already looked
   * for a spot to hold at this move. Holding: the spot it was pushing to, the spot it holds at, who covered it, how long
   * it has held, and the time to its next ask for cover.
   */
  private moveCover: MoveCover = null;
  private coverGoneSec = 0;
  private holdLooked = false;
  private heldGoal: CoverPoint | null = null;
  private heldAt: CoverPoint | null = null;
  private heldCover: MoveCover = null;
  private heldSec = 0;
  private askLeftSec = 0;
  private speedNowMps = 0;
  private moveX = 0;
  private moveZ = 0;
  /** Whether it walked this update; if not, it is standing (speed 0). */
  private walkedThisUpdate = false;
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
  private peekMode: 'aimed' | 'cover' | 'suppress' | 'look' | 'throw' = 'look';
  private peekRounds = 0;
  private readonly peekEyes = new Vector3();

  constructor(
    private readonly spawn: { readonly xM: number; readonly zM: number; readonly yawRad: number; readonly role?: Role },
    private readonly hooks: StandInHooks,
    private readonly random: () => number = Math.random,
  ) {
    this.role = spawn.role ?? 'trooper';
    this.placeAtSpawn();
  }

  /** Its role's values (live, so the dev panel can change them): health, speeds, burst length, liked cover range. */
  get values(): RoleValues {
    return roleConfig[this.role];
  }

  /** The gun it carries, from its role (4.12): it decides the damage of its hits. */
  get gun(): EnemyGun {
    return gunOfRole[this.role];
  }

  /** How many grenades it still carries (4.12). */
  get grenades(): number {
    return this.grenadesLeft;
  }

  /** True while it has a throw to make (from the squad giving it until it throws or the throw is called off). */
  get isThrowing(): boolean {
    return this.throwPlan !== null;
  }

  get isClimbing(): boolean {
    return this.climbing;
  }

  /** True if the squad could send it up now: not the heavy, not wounded, and in cover or walking (no throw, no covering fire). */
  get canClimb(): boolean {
    return (
      this.awake && !this.frozen && !this.wounded && !this.grenadeSeen && !this.inBurst && !this.suppressing && !this.pressing && !this.climbing &&
      this.role !== 'heavy' && (this.state === 'cover' || this.state === 'approach' || this.state === 'shoot')
    );
  }

  get xM(): number {
    return this.feet.x;
  }

  get zM(): number {
    return this.feet.z;
  }

  get yM(): number {
    return this.feet.y;
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
    const walking = ['approach', 'retreat', 'flee', 'flank', 'advance', 'hunt'].includes(this.state);
    if (!walking) return out;
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
   * also tells it where he was (`rookFeetYM`: the floor he is on); one made where his bullet or grenade landed does not (decision 219).
   */
  hear(noise: Noise, rookFeetYM = 0): void {
    if (!this.canHear(noise)) return;
    if (!awayFromRook.has(noise.kind)) {
      this.lastKnown.set(noise.position.x, rookFeetYM, noise.position.z); // the noise is at his eyes, so his floor comes from the caller
      this.knowsWhere = true;
      this.lastKnownAgeSec = 0;
    }
    if (this.state === 'idle') this.wake();
  }

  /** True if this noise carries to its ears: within its range, or half of it through a wall or prop (4.10). */
  canHear(noise: Noise): boolean {
    if (this.state === 'falling' || this.state === 'down') return false;
    this.ears.set(this.feet.x, this.feet.y + this.eyeHeightNowM, this.feet.z);
    return hearsNoise(noise, this.ears, () => this.hooks.noiseBlocked(noise.position, this.ears));
  }

  hit(zone: HitZone, bodyDamage: number): boolean {
    if (!this.hittable) return false;
    if (zone === 'head') return this.kill();
    const killed = this.health.damage(bodyDamage);
    if (killed) this.die();
    else if (this.state === 'idle') this.wake();
    else {
      if (this.peekPhase === 'tell' || this.peekPhase === 'out' || this.peekPhase === 'fire') {
        this.wantsMove = true; // hurt while peeking: this spot is known, it moves on after (decision 237)
        if (this.pressing) this.startPeekBack(); // a flank attack or suppressing: back in at once
      }
      this.countDamage(bodyDamage);
    }
    return killed;
  }

  /** True during a flinch (decision 246). */
  get flinching(): boolean {
    return this.flinchLeftSec > 0;
  }

  /** How far into its tip back a flinch is: 1 as it starts, easing to 0 as it ends. Drawing only. */
  get flinchShare(): number {
    return standInConfig.flinchSec > 0 ? Math.max(this.flinchLeftSec, 0) / standInConfig.flinchSec : 0;
  }

  /** Adds a hit to the damage within the flinch window; enough of it, and it flinches (decision 246). */
  private countDamage(damage: number): void {
    const hits = this.recentHits;
    hits.push({ atSec: this.clockSec, damage });
    while (hits.length > 0 && hits[0].atSec < this.clockSec - standInConfig.flinchWindowSec) hits.shift();
    const totalDamage = hits.reduce((sum, hit) => sum + hit.damage, 0);
    if (totalDamage >= this.values.flinchDamage && this.clockSec >= this.flinchFreeAtSec) this.flinch();
  }

  /**
   * Heavy damage (decision 246): its burst is cut off and it slows for a moment. Peeking, it ducks back in, holds longer
   * and moves on after. On the move, it drops its spot and heads for the nearest cover, firing back as it goes (panic
   * fire); with none, it fights where it stands. Standing its ground, it only flinches; running from a grenade, not even that.
   */
  private flinch(): void {
    if (this.state === 'flee') return;
    const { flinchSec, flinchImmuneSec } = standInConfig;
    this.recentHits.length = 0;
    this.flinchLeftSec = flinchSec;
    this.flinchFreeAtSec = this.clockSec + flinchSec + flinchImmuneSec;
    this.roundsInBurst = 0; // the burst is cut off...
    this.cooldownSec = Math.max(this.cooldownSec, flinchSec); // ...and nothing fires during the flinch
    this.cancelReload(); // a reload starts over later (4.16)
    const peeking = this.state === 'cover' && (this.peekPhase === 'tell' || this.peekPhase === 'out' || this.peekPhase === 'fire');
    if (peeking) {
      this.pinnedByRook = true; // its next hold is longer
      this.wantsMove = true;
      this.startPeekBack();
      return;
    }
    const moving = ['flank', 'advance', 'hunt', 'approach', 'retreat'].includes(this.state);
    if (!moving) return;
    const next = this.hooks.pickNearestCover(this);
    if (!next) {
      this.leaveCover();
      this.beginFight();
      return;
    }
    this.setCover(next);
    this.setState('retreat'); // a squad move it was on ends here, and the squad hears of it
    this.panicking = true;
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
    this.clockSec += dtSec;
    this.flinchLeftSec = Math.max(this.flinchLeftSec - dtSec, 0);
    this.walkedThisUpdate = false;
    if (this.reloadLeftSec > 0) {
      this.reloadLeftSec = Math.max(this.reloadLeftSec - dtSec, 0);
      if (this.reloadLeftSec === 0) {
        this.roundsLeft = this.magazineRounds;
        this.hooks.reloadDone(this);
      }
    }
    if (this.heldGoal) this.tickHeldPush(dtSec);
    this.think(dtSec, player);
    if (!this.walkedThisUpdate) {
      this.speedNowMps = 0; // standing (its walks brake to a stop before they end), and the next walk sets off afresh
      this.moveX = 0;
      this.moveZ = 0;
    }
    if (this.hasSlot && !this.inBurst) this.giveSlotBack(); // a slot covers one burst, and goes back whatever ended it
  }

  /**
   * True during a burst: firing one, or peeking out to fire one (from the tell until it starts back in). A throw counts
   * as one from the moment the squad gives it (4.12): it is busy, and keeps its slot until it has thrown.
   */
  private get inBurst(): boolean {
    if (!this.awake || this.frozen) return false;
    const peeking = this.state === 'cover' && (this.peekPhase === 'tell' || this.peekPhase === 'out' || this.peekPhase === 'fire');
    return peeking || this.throwPlan !== null || (this.engaged && this.roundsInBurst > 0);
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
      if (!squadConfig.respawnTogether && this.stateSec >= standInConfig.respawnDelaySec) {
        this.placeAtSpawn();
        this.wake(); // decision 201: it gets up awake
      }
      return;
    }
    if (this.state === 'idle' || this.frozen) {
      this.endSuppress(); // frozen (dev aid): it is not pinning anyone
      return;
    }

    this.sightTimerSec -= dtSec;
    if (this.sightTimerSec <= 0) {
      this.seesPlayer = this.hooks.canSeePlayer(this);
      this.sightTimerSec = 1 / standInConfig.sightChecksPerSec;
      this.rookSeesIt = this.hooks.rookSees(this);
      if (this.rookSeesIt) this.contacted = true;
      // It looks for grenades as often as it looks for Rook.
      if (!this.grenadeSeen && this.state !== 'flee' && this.hooks.spotGrenade(this, this.grenadeDangerM, this.grenadeAt)) {
        this.grenadeSeen = true;
        this.grenadeReactSec = standInConfig.grenadeReactionSec;
      }
    }
    // Seeing him tells it where he is. Woken by a hit, or just up again, it starts from where he is too.
    this.lastKnownAgeSec += dtSec;
    if (this.seesPlayer || !this.knowsWhere) {
      this.lastKnown.set(player.x, player.y, player.z);
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
    if (this.state === 'flank' || this.state === 'advance' || this.state === 'hunt') {
      this.move(dtSec, player);
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
        // It runs between cover; the heavy walks and fires as it goes (decision 246).
        if (this.state !== 'approach') this.startWalking(); // once: starting a walk resets its aim
        const firing = this.firesOnTheMove;
        if (!this.walkRoute(dtSec, this.coverSpot, this.values.runSpeedMps, !firing)) {
          this.giveUpWalk(); // drop the spot; pick again straight away
          return;
        }
        if (firing) this.fireOnTheMove(dtSec, dx, dz);
        return;
      }
      // At its spot: crouch behind low cover, hold, and peek out every so often.
      this.setState('cover');
      this.crouched = this.coverPoint.height === 'low';
      this.holdAndPeek(dtSec, this.coverPoint, dx, dz);
      return;
    }

    // No cover hides it: the 4.1 behaviour. Head for Rook, and stop to fire once it sees him within range.
    if (!this.climbing && this.seesPlayer && distanceM <= standInConfig.stopRangeM) {
      this.setState('shoot');
      this.engage(dtSec, dx, dz);
      return;
    }
    this.startWalking();
    if (distanceM > standInConfig.closestM) this.walkRoute(dtSec, player, this.values.walkSpeedMps, true, standInConfig.closestM); // if no route, it keeps trying
  }

  /**
   * Every so often: if it has no cover, or its spot no longer hides it, it picks the best spot (maybe none). If its spot
   * fails while it can see Rook, it answers with a fight first instead of walking off (decision 209).
   */
  private checkCover(dtSec: number): void {
    if (this.state === 'fight' || this.state === 'retreat' || this.state === 'flee') return; // those pick their own next spot
    if (this.climbing) {
      // On its way to Rook's floor: no cover on the way (it would pick the floor it is leaving). Done once there, or given up.
      this.climbSec += dtSec;
      if (this.hooks.onRookFloor?.(this) !== false || this.climbSec > squadConfig.climbGiveUpSec) {
        this.climbing = false;
        this.coverTimerSec = 0;
      } else {
        if (this.coverPoint) this.leaveCover();
        return;
      }
    }
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
    if (next !== this.coverPoint) {
      // A new spot: count its peeks afresh, and decide after how many it will move on (decision 237).
      this.peeksHere = 0;
      this.blindPeeks = 0;
      this.wantsMove = false;
      const { repositionPeeksMin, repositionPeeksMax } = squadConfig;
      this.repositionAfter = repositionPeeksMin + Math.floor(this.random() * (Math.max(repositionPeeksMax - repositionPeeksMin, 0) + 1));
    }
    this.coverPoint = next;
    this.spotHides = next !== null; // a picked spot hides it (that is how it was picked)
    if (next) this.coverSpot.set(next.xM, next.yM ?? 0, next.zM);
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

  /** True if the squad may send it to flank: awake, not wounded, frozen, fighting or mid-burst, and no grenade on its mind. */
  get canFlank(): boolean {
    if (!this.awake || this.frozen || this.wounded || this.grenadeSeen || this.inBurst) return false;
    if (this.values.flankSpeedMps <= 0) return false; // a heavy never flanks
    return this.state === 'approach' || this.state === 'cover';
  }

  /** True if the squad may send it to closer cover (4.9): holding cover, not wounded, frozen or mid-burst. */
  get canAdvance(): boolean {
    return this.awake && !this.frozen && !this.wounded && !this.grenadeSeen && !this.inBurst && this.state === 'cover';
  }

  /** True if the squad may have it pin Rook's cover: holding cover with fresh knowledge of where he is. */
  get canSuppress(): boolean {
    if (!this.awake || this.frozen || this.wounded || this.grenadeSeen || this.inBurst) return false;
    return this.state === 'cover' && this.coverPoint !== null && this.knowsFresh;
  }

  /**
   * True if the squad may have it throw a grenade (4.12): it carries one, holds cover between peeks, is not wounded,
   * frozen, suppressing or busy, and has no grenade of Rook's on its mind.
   */
  get canThrow(): boolean {
    if (!this.awake || this.frozen || this.wounded || this.grenadeSeen || this.inBurst || this.suppressing) return false;
    return this.grenadesLeft > 0 && this.state === 'cover' && this.coverPoint !== null && this.peekPhase === 'hold';
  }

  /** The squad has it throw (4.12): it peeks at once from the planned side (with the tell), winds up, and throws. */
  beginThrow(plan: ThrowPlan): void {
    this.throwPlan = plan;
    this.peekTimerSec = 0;
  }

  /** Its throw is over, `thrown` or not: the squad hears of it. */
  private endThrow(thrown: boolean): void {
    if (!this.throwPlan) return;
    this.throwPlan = null;
    this.hooks.throwOver(this, thrown);
  }

  /** True while it pins the edge of Rook's cover for a squadmate. */
  get isSuppressing(): boolean {
    return this.suppressing;
  }

  /** Which side of Rook's cover it pins: 1 or -1, as seen from it (right or left of the line to him). */
  get suppressSideSign(): number {
    return this.suppressSide;
  }

  /** The squad sends it round Rook's side to `point` (4.7): it claims the spot and walks there without firing. */
  beginFlank(point: CoverPoint): void {
    this.flankSpottedSec = 0;
    this.beginMove(point, 'flank');
  }

  /**
   * The squad's storey push (decision 277): Rook fights from another floor, so it leaves its cover and walks to him (no cover
   * on the way, no stopping to shoot from the wrong floor) until it is on his floor; then it picks cover there, or fights.
   */
  beginClimb(): void {
    this.climbing = true;
    this.climbSec = 0;
    this.leaveCover();
    this.resetPeek();
    this.dropHeldPush();
    this.crouched = false;
    this.engaged = false;
    this.setState('approach');
    this.repathTimerSec = 0;
  }

  /**
   * The squad sends it to closer cover at `point` under a squadmate's covering fire (4.9). `cover` says who covers it: if
   * that fire stops on the way, it holds at near cover and asks again (4.17); null for a move nobody covers.
   */
  beginAdvance(point: CoverPoint, cover: MoveCover = null): void {
    this.beginMove(point, 'advance');
    this.moveCover = cover;
  }

  /**
   * The squad sends it hunting (decision 235) to cover at `point`, near where the squad last knew Rook was. The hunt's
   * leader goes at its flank speed, a follower at its walking speed.
   */
  beginHunt(point: CoverPoint, leads: boolean): void {
    this.huntLeads = leads;
    this.beginMove(point, 'hunt');
  }

  /**
   * The squad shares where it last knew Rook was (the hunt, decision 235): it takes `spot`, heard or seen `ageSec` ago, if
   * that is newer than what it knows. It stays old knowledge, so it only looks there.
   */
  shareLastKnown(spot: Vector3, ageSec: number): void {
    if (this.knowsWhere && this.lastKnownAgeSec <= ageSec) return;
    this.lastKnown.set(spot.x, spot.y, spot.z);
    this.knowsWhere = true;
    this.lastKnownAgeSec = ageSec;
  }

  private beginMove(point: CoverPoint, state: 'flank' | 'advance' | 'hunt'): void {
    this.moveCover = null;
    this.coverGoneSec = 0;
    this.holdLooked = false;
    this.dropHeldPush(); // a new move ends any held push
    this.hooks.claimCover(this, point);
    this.setCover(point);
    this.crouched = false;
    this.engaged = false;
    this.setState(state);
  }

  /**
   * The squad has it pin Rook's cover (4.9): from its cover it peeks at once (with the tell) and stays out firing long
   * bursts at the edge of his cover, one side of it, until the squad says the move it covers is over, its time is up, or
   * Rook hurts it. If it sees him it fires aimed rounds instead.
   */
  beginSuppress(): void {
    this.suppressing = true;
    this.suppressSide = this.random() < 0.5 ? -1 : 1;
    if (this.peekPhase === 'hold') this.peekTimerSec = 0;
  }

  private endSuppress(): void {
    if (!this.suppressing) return;
    this.suppressing = false;
    this.hooks.suppressOver(this);
  }

  /**
   * One of Rook's rounds passed or landed close while it was out of cover (the Suppressed state, 4.9): it ducks back in at
   * once and holds longer. True if it was out and is pinned now.
   */
  pinDown(): boolean {
    if (this.state !== 'cover' || (this.peekPhase !== 'tell' && this.peekPhase !== 'out' && this.peekPhase !== 'fire')) return false;
    this.pinnedByRook = true;
    this.wantsMove = true; // pinned: this spot is known, it moves on (decision 237)
    this.startPeekBack();
    return true; // it was out and is pinned now (its "Pinned" callout, 4.14)
  }

  /**
   * On a flank or an advance: it walks to its spot, facing the way it goes, without firing. A flank goes at the flank
   * speed and is called off if Rook sees it for a moment (it takes cover as usual from where it is); on arrival it comes
   * out firing (the flank attack). An advance goes at its walking speed under covering fire and does not turn back unless
   * its spot stops hiding it; on arrival it holds and peeks as usual. A hunt move goes like an advance (the leader at its
   * flank speed), and once the hunt stops (Rook was found) it takes cover from where it is, as a called-off flank does.
   */
  private move(dtSec: number, player: Vector3): void {
    const flanking = this.state === 'flank';
    if (this.state === 'hunt' && !this.hooks.hunting()) {
      this.giveUpWalk();
      return;
    }
    const firing = !flanking && this.firesOnTheMove; // the heavy keeps firing while it moves (decision 237)
    this.flankSpottedSec = flanking && this.rookSeesIt ? this.flankSpottedSec + dtSec : 0;
    if (this.flankSpottedSec >= squadConfig.spottedSec) {
      this.giveUpWalk(); // spotted: lets the spot go and looks for cover straight away
      return;
    }
    const toSpotM = Math.hypot(this.coverSpot.x - this.feet.x, this.coverSpot.z - this.feet.z);
    if (toSpotM <= standInConfig.coverArriveM) {
      this.coverTimerSec = 0; // check the spot still hides it straight away
      this.setState('cover');
      if (!flanking) return;
      // The flank attack: no hold first; it peeks at once (the tell still warns Rook) and stays out firing.
      this.peekTimerSec = 0;
      this.pressing = true;
      this.pressSec = 0;
      this.pressUnseenSec = 0;
      return;
    }
    if (!flanking) {
      // An advance re-checks its spot as it goes: if Rook moved and it no longer hides it, it takes cover from here (decision 239).
      this.coverTimerSec -= dtSec;
      if (this.coverTimerSec <= 0) {
        this.coverTimerSec = standInConfig.coverCheckIntervalSec;
        if (this.coverPoint && !this.hooks.coverHides(this.coverPoint)) {
          this.giveUpWalk();
          return;
        }
      }
    }
    if (this.state === 'advance' && this.moveCover !== null && this.holdForCover(dtSec)) return;
    // Every move between cover is at least a run (decision 246); flanks and the hunt's leader go at their flank speed if faster.
    const fast = flanking || (this.state === 'hunt' && this.huntLeads);
    const speedMps = fast ? Math.max(this.values.flankSpeedMps, this.values.runSpeedMps) : this.values.runSpeedMps;
    if (!this.walkRoute(dtSec, this.coverSpot, speedMps, !firing)) {
      this.giveUpWalk();
      return;
    }
    if (firing) this.fireOnTheMove(dtSec, player.x - this.feet.x, player.z - this.feet.z);
  }

  /**
   * The heavy's fire while it moves (decision 237): aimed bursts at Rook when it sees him (at the backing-off share of the
   * hit chance), suppressing bursts at the edge of his cover when it does not (pinning that side), if the squad's tier has
   * suppressing fire (4.11). Each burst needs a slot.
   */
  private fireOnTheMove(dtSec: number, dx: number, dz: number): void {
    if (this.seesPlayer) {
      this.engage(dtSec, dx, dz, standInConfig.retreatHitChanceShare);
      return;
    }
    if (!this.knowsFresh || !this.hooks.suppressionAllowed()) {
      this.engaged = false;
      return;
    }
    if (!this.engaged) {
      this.engaged = true;
      this.roundsInBurst = 0;
      this.cooldownSec = 0;
      this.suppressSide = this.random() < 0.5 ? -1 : 1; // which edge of his cover it pins this time
    }
    if (this.faceLastKnown(dtSec) > standInConfig.aimToleranceDeg * degToRad) return;
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    if (this.needsReload) this.startReload(); // empty: it reloads where it is (4.16)
    if (this.reloading) return;
    if (!this.lineClear('suppress')) {
      this.cooldownSec = standInConfig.roundIntervalSec; // something close (or a squadmate) is in the way: try again a step on (decision 239)
      return;
    }
    if (!this.takeSlot()) {
      this.cooldownSec = 0;
      return;
    }
    this.hooks.fire(this, 'suppress');
    this.roundFired();
    this.roundsInBurst++;
    if (this.roundsInBurst < squadConfig.suppressBurstRounds) {
      this.cooldownSec += standInConfig.roundIntervalSec;
      return;
    }
    this.roundsInBurst = 0;
    this.cooldownSec += squadConfig.suppressBurstPauseSec;
  }

  /** Runs from the grenade it saw: picks where to, says so, and goes. */
  private startFlee(): void {
    this.climbing = false;
    this.grenadeSeen = false;
    this.hooks.grenadeSpotted(this);
    const point = this.hooks.planFlee(this, this.grenadeAt, this.grenadeDangerM, this.fleeSpot);
    this.coverPoint = point;
    this.spotHides = false; // a flee spot may not hide it; it checks once it is there
    if (point) this.coverSpot.set(point.xM, point.yM ?? 0, point.zM);
    this.crouched = false;
    this.engaged = false;
    this.cancelReload(); // running for its life: the reload starts over later (4.16)
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

  /**
   * Backs off to its new cover, slower, facing Rook and firing while it can see him (decision 210). After a flinch it runs
   * there instead, firing back less accurately (panic fire, decision 246).
   */
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
    const { retreatSpeedShare, retreatHitChanceShare, panicHitChanceShare } = standInConfig;
    const speedMps = this.panicking ? this.values.runSpeedMps : this.values.walkSpeedMps * retreatSpeedShare;
    if (!this.walkRoute(dtSec, this.coverSpot, speedMps, !firing)) {
      this.giveUpWalk(); // stop backing off and check its cover
      return;
    }
    if (firing) this.engage(dtSec, dx, dz, this.panicking ? panicHitChanceShare : retreatHitChanceShare);
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
    if (this.peekPhase === 'hold' && (this.reloading || this.needsReload || this.wantsTopUp)) {
      // Reloading behind its cover (4.16): no peeks meanwhile; it keeps watching where Rook was.
      if (!this.reloading) this.startReload();
      this.engaged = false;
      this.faceLastKnown(dtSec);
      return;
    }
    if (this.peekPhase === 'hold') {
      // It fires from where it holds if it sees Rook and its own cover is not in the way; else it peeks (decision 239).
      // With a throw to make it peeks to throw instead (4.12).
      const throwing = this.throwPlan !== null;
      if (!throwing && this.seesPlayer && this.lineClear('hit')) {
        this.engage(dtSec, dx, dz);
        return;
      }
      this.engaged = false;
      this.faceLastKnown(dtSec); // it watches where Rook was, never turning its back on him (decision 213)
      if (this.suppressing && !this.hooks.keepSuppressing(this)) this.endSuppress(); // the move it was to cover is over
      if (this.suppressing || throwing) this.peekTimerSec = Math.min(this.peekTimerSec, 0); // out again at once
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
      if (this.peekTimerSec <= 0) {
        this.peekDone();
        this.resetPeek();
      }
    }
  }

  /**
   * The tell: picks how to come out, warns with a sound, and starts to move. Low cover offers rising over the top (0) and
   * its open sides; high cover its open sides only (1 is right, -1 left, as seen facing the cover). It picks at random
   * among the ways that let it see Rook; if none does, among those whose gun can reach his cover (decision 239), or else
   * among all of them (decision 216).
   */
  private startTell(point: CoverPoint): void {
    const ways = peekWays(point);
    const shotClear = (side: number) => ways.filter((way) => this.hooks.coverShotClear(this, point, way, side));
    // A throw comes out the way it was planned from (4.12); otherwise it prefers a way that lets it see Rook.
    let choices = this.throwPlan ? [this.throwPlan.way] : ways.filter((way) => this.hooks.seesPlayerFrom(peekEyesAt(point, way, this.peekEyes)));
    // Not seeing him, it comes out where its gun can reach his cover (decision 239): a suppressor at the edge it pins (or
    // the other edge if none can), anyone else straight at it, in case this peek fires at his cover.
    if (choices.length === 0 && this.suppressing) {
      choices = shotClear(this.suppressSide);
      if (choices.length === 0) {
        this.suppressSide = -this.suppressSide;
        choices = shotClear(this.suppressSide);
      }
    } else if (choices.length === 0 && this.knowsFresh) {
      choices = shotClear(0);
    }
    if (choices.length === 0) choices = ways;
    const way = choices[Math.min(Math.floor(this.random() * choices.length), choices.length - 1)];
    this.peekSide.set(way * Math.cos(point.facingYawRad), 0, way * -Math.sin(point.facingYawRad)); // 0 rises: no step
    this.hooks.peekTell(this);
    if (this.suppressing) {
      this.pressing = true; // suppressing stays out, like the flank attack
      this.pressSec = 0;
      this.pressUnseenSec = 0;
    }
    this.peekPhase = 'tell';
    this.peekTimerSec = standInConfig.tellSec;
  }

  /**
   * Fully out: it looks once, then fires at Rook if it sees him, at his cover by chance if not, or only looks. With a
   * throw to make, it winds up instead (4.12).
   */
  private startPeekFire(): void {
    this.peekPhase = 'fire';
    this.seesPlayer = this.hooks.canSeePlayer(this);
    this.sightTimerSec = 1 / standInConfig.sightChecksPerSec;
    if (this.throwPlan) {
      this.peekMode = 'throw';
      this.lastPeekBlind = false;
      this.peekTimerSec = enemyGrenadeConfig.throwWindupSec;
      return;
    }
    // Fire at his cover only on fresh knowledge of where he is (decision 216); old knowledge, it only looks.
    const fireAtCover = this.knowsFresh && this.random() < standInConfig.hiddenFireChance;
    this.peekMode = this.seesPlayer ? 'aimed' : this.suppressing ? 'suppress' : fireAtCover ? 'cover' : 'look';
    this.lastPeekBlind = !this.seesPlayer && !this.suppressing; // pinning his cover for a squadmate is not blind
    this.peekRounds = 0;
    this.cooldownSec = 0; // the tell was the warning: no extra reaction pause
    this.peekTimerSec = this.values.burstRounds * standInConfig.roundIntervalSec; // how long a look lasts
  }

  /**
   * Out of cover: fires one burst (or looks for as long as one would take), then goes back in. In a flank attack it stays
   * out, firing a burst at Rook whenever it sees him, until the attack ends (see `pressOver`).
   */
  private peekFire(dtSec: number, dx: number, dz: number): void {
    if (this.peekMode === 'throw') {
      this.windUpThrow(dtSec);
      return;
    }
    if (this.pressing) {
      if (this.pressOver(dtSec)) {
        this.startPeekBack();
        return;
      }
      if (this.peekMode === 'look' && this.seesPlayer) this.peekMode = 'aimed';
    }
    // It aims at Rook when it sees him; otherwise at where it last knew he was (decision 213).
    const facingErrorRad = this.peekMode === 'aimed' ? this.turnToward(dx, dz, dtSec) : this.faceLastKnown(dtSec);
    if (this.peekMode === 'look') {
      if (!this.pressing && this.peekTimerSec <= 0) this.startPeekBack();
      return;
    }
    if (facingErrorRad > standInConfig.aimToleranceDeg * degToRad) return;
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    const suppressFire = this.peekMode === 'suppress';
    const aimedAs: StandInShot = this.peekMode === 'cover' ? 'cover' : suppressFire ? 'suppress' : 'hit';
    if (this.needsReload) {
      this.startPeekBack(); // empty: back into cover to reload there (4.16)
      return;
    }
    if (!this.lineClear(aimedAs)) {
      this.startPeekBack(); // its own cover (or a squadmate) is in the way: no clear shot from this peek (decisions 239, 266)
      return;
    }
    if (this.peekRounds === 0 && !this.takeSlot()) {
      this.cooldownSec = 0; // every burst needs a firing slot: keep aiming and fire as soon as one is free
      return;
    }
    this.hooks.fire(this, aimedAs === 'hit' ? this.aimedShot(1) : aimedAs);
    this.roundFired();
    this.peekRounds++;
    this.cooldownSec += standInConfig.roundIntervalSec;
    if (this.peekRounds < (suppressFire ? squadConfig.suppressBurstRounds : this.values.burstRounds)) return;
    this.contacted = true; // a whole burst fired: the warning has been given
    if (!this.pressing) {
      this.startPeekBack();
      return;
    }
    // The flank attack or the suppressing goes on: the slot goes back between bursts. The next burst fires at Rook if it
    // sees him; otherwise a suppressor pins his cover again, and a flank attacker only looks.
    this.giveSlotBack();
    this.peekRounds = 0;
    const pauseSec = this.suppressing ? squadConfig.suppressBurstPauseSec : standInConfig.burstPauseSec;
    this.cooldownSec += pauseSec - standInConfig.roundIntervalSec;
    this.peekMode = this.seesPlayer ? 'aimed' : this.suppressing ? 'suppress' : 'look';
  }

  /**
   * Out of cover with a throw to make (4.12): it faces the throw for the wind-up, then lets go if the throw is still on
   * (Rook has not moved away) and goes back in. Called off, it keeps its grenade.
   */
  private windUpThrow(dtSec: number): void {
    const plan = this.throwPlan;
    if (!plan) {
      this.startPeekBack();
      return;
    }
    this.turnToward(plan.velocity.x, plan.velocity.z, dtSec);
    if (this.peekTimerSec > 0) return;
    const thrown = this.hooks.throwStillOn(this, plan);
    if (thrown) {
      this.hooks.throwGrenade(this, plan);
      this.grenadesLeft--;
    }
    this.endThrow(thrown);
    this.startPeekBack();
  }

  /**
   * Out in a flank attack or suppressing: true once it should go back in. A flank attack ends after its time, or once it
   * has not seen Rook for a moment; suppressing ends when the squad says the move it covers is over, or after its time.
   */
  private pressOver(dtSec: number): boolean {
    this.pressSec += dtSec;
    if (this.suppressing) return !this.hooks.keepSuppressing(this) || this.pressSec >= squadConfig.suppressMaxSec;
    this.pressUnseenSec = this.seesPlayer ? 0 : this.pressUnseenSec + dtSec;
    return this.pressSec >= squadConfig.flankPressMaxSec || this.pressUnseenSec >= squadConfig.flankPressLostSightSec;
  }

  private startPeekBack(): void {
    this.peekPhase = 'back';
    this.peekTimerSec = standInConfig.peekBackSec;
    this.pressing = false; // a flank attack ends when it goes back in
    this.endSuppress(); // and so does suppressing
    this.endThrow(false); // and a throw not made by now (hurt, pinned) is called off
  }

  /**
   * A peek from its spot is over (decision 237): after enough peeks from one spot, or too many blind ones in a row, it
   * wants to move to another. The squad decides when (one at a time, with covering fire or by a hidden route).
   */
  private peekDone(): void {
    this.peeksHere++;
    this.blindPeeks = this.lastPeekBlind ? this.blindPeeks + 1 : 0;
    this.lastPeekBlind = false;
    if (this.peeksHere >= this.repositionAfter || this.blindPeeks >= squadConfig.repositionBlindPeeks) this.wantsMove = true;
  }

  /** True when it wants to move to another spot and can (holding cover, not mid-peek): the squad decides (decision 237). */
  get wantsToReposition(): boolean {
    return this.wantsMove && this.canAdvance && this.peekPhase === 'hold';
  }

  /** The squad turned the move down for now (no spot, or no cover and too open a route): it asks again after another peek. */
  repositionDeclined(): void {
    this.wantsMove = false;
  }

  /** The squad sends it to another spot (decision 237): like an advance (covered, not turned back), not necessarily closer. */
  beginReposition(point: CoverPoint, cover: MoveCover = null): void {
    this.beginAdvance(point, cover);
  }

  /** True if it fires while it moves (the heavy, decision 237): it is its own covering fire. */
  get firesOnTheMove(): boolean {
    return this.values.firesOnTheMove > 0;
  }

  /** Back to holding, for a random while. */
  private resetPeek(): void {
    this.pressing = false;
    this.peekPhase = 'hold';
    this.peekShare = 0;
    this.riseShare = 0;
    const { peekHoldMinSec, peekHoldMaxSec, woundedHoldScale } = standInConfig;
    const holdSec = peekHoldMinSec + this.random() * Math.max(peekHoldMaxSec - peekHoldMinSec, 0);
    // Wounded, with its squad disorganised (its leader down), or pinned by Rook's fire, it stays tucked in longer; the hunt
    // makes its watcher peek more often, and a careful hold after a hunt that found nothing less often.
    const scale =
      (this.wounded ? woundedHoldScale : 1) * (this.hooks.disorganised() ? squadConfig.disorderHoldScale : 1) * this.hooks.huntHoldScale(this);
    this.peekTimerSec = holdSec * scale * (this.pinnedByRook ? squadConfig.pinnedHoldScale : 1);
    this.pinnedByRook = false;
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

  /** Stands up and starts walking (a heavy walking to its cover fires as it goes, decision 246). */
  private startWalking(): void {
    this.crouched = false;
    this.engaged = false;
    if (this.state === 'approach') return;
    this.setState('approach');
    this.repathTimerSec = 0; // a fresh route from here
  }

  /**
   * A covered advance checks its cover as it goes (4.17): gone for longer than `coverLostSec`, it holds at the nearest
   * free cover that hides it, if that is nearer than its goal (else it keeps going: stopping in the open is worse). True
   * if it turned off to hold.
   */
  private holdForCover(dtSec: number): boolean {
    const live = this.moveCover === 'self' ? !this.reloading && !this.needsReload : this.hooks.coverLive(this);
    this.coverGoneSec = live ? 0 : this.coverGoneSec + dtSec;
    if (this.coverGoneSec <= squadConfig.coverLostSec || this.holdLooked) return false;
    this.holdLooked = true; // looked once this move: no spot now means it runs on
    const goal = this.coverPoint;
    const hold = this.hooks.pickHoldSpot(this, goal);
    if (!hold || !goal) return false;
    const cover = this.moveCover;
    this.startWalking(); // the advance is over for the squad (its play ends); it takes cover at the hold spot as usual
    this.hooks.claimCover(this, hold);
    this.setCover(hold);
    this.heldGoal = goal;
    this.heldAt = hold;
    this.heldCover = cover;
    this.heldSec = 0;
    this.askLeftSec = 0; // it asks as soon as it is in cover
    this.hooks.pushHeld(this);
    return true;
  }

  /** Holding a push (4.17): the clocks; it gives the push up after a while, or once it has left the spot it held at. */
  private tickHeldPush(dtSec: number): void {
    this.heldSec += dtSec;
    this.askLeftSec = Math.max(this.askLeftSec - dtSec, 0);
    if (this.heldSec >= squadConfig.pushGiveUpSec || this.coverPoint !== this.heldAt) this.dropHeldPush();
  }

  /** True while it holds a push at near cover, waiting for covering fire (4.17). */
  get holdingPush(): boolean {
    return this.heldGoal !== null;
  }

  /** The spot it was pushing to while it holds, or null. */
  get heldPushGoal(): CoverPoint | null {
    return this.heldGoal;
  }

  /** True if the held push was its own cover (the heavy): it goes on once its reload is done, needing nobody. */
  get heldBySelf(): boolean {
    return this.heldCover === 'self';
  }

  /** Holding at its spot and due to ask for covering fire again (every `askCoverEverySec`): the squad answers (main.ts). */
  get asksForCover(): boolean {
    return this.heldGoal !== null && this.state === 'cover' && this.askLeftSec <= 0;
  }

  /** It asked; the next ask is a while later. */
  askedForCover(): void {
    this.askLeftSec = squadConfig.askCoverEverySec;
  }

  /** Covered again: it goes on to the spot it was pushing to, covered by `cover`. */
  resumePush(cover: 'squad' | 'self'): void {
    const goal = this.heldGoal;
    if (!goal) return;
    this.beginAdvance(goal, cover);
  }

  /** The push is given up (too long without cover, the goal gone, or it moved off): it fights from where it is. */
  dropHeldPush(): void {
    this.heldGoal = null;
    this.heldAt = null;
    this.heldCover = null;
  }

  /** Its gun's magazine size (4.16). */
  get magazineRounds(): number {
    return Math.max(Math.round(enemyGunConfig[this.gun].magazineRounds), 1);
  }

  /** Rounds left in its magazine (4.16). */
  get rounds(): number {
    return this.roundsLeft;
  }

  /** True while it reloads (4.16): it neither peeks nor fires. */
  get reloading(): boolean {
    return this.reloadLeftSec > 0;
  }

  /** In cover, low on rounds and with no sight or sound of Rook for a while: it tops up its magazine (4.16). */
  private get wantsTopUp(): boolean {
    return (
      this.state === 'cover' &&
      this.throwPlan === null &&
      !this.suppressing &&
      this.roundsLeft < this.magazineRounds * standInConfig.topUpBelowShare &&
      this.lastKnownAgeSec >= standInConfig.topUpCalmSec
    );
  }

  private startReload(): void {
    this.needsReload = false;
    this.reloadLeftSec = Math.max(enemyGunConfig[this.gun].reloadSec, dtFloorSec);
    this.roundsInBurst = 0; // its burst is over: the firing slot goes back
    this.hooks.reloadStarted(this);
  }

  /** A reload cut short (a flinch, a grenade, going down): it keeps its rounds and reloads again later. */
  private cancelReload(): void {
    if (this.reloadLeftSec <= 0) return;
    this.reloadLeftSec = 0;
    this.needsReload = this.roundsLeft === 0;
  }

  private roundFired(): void {
    this.roundsLeft = Math.max(this.roundsLeft - 1, 0);
    if (this.roundsLeft === 0) this.needsReload = true;
  }

  /**
   * True if the round it is about to fire (aimed as `shot` aims) has a clear line: its own cover is not in the way
   * (decision 239) and no squadmate stands in it (4.16). A squadmate in the way for a while makes it want to move on.
   */
  private lineClear(shot: StandInShot): boolean {
    if (!this.hooks.muzzleClear(this, shot)) return false;
    if (!this.hooks.friendInLine(this, shot)) {
      this.friendBlockedSinceSec = null;
      return true;
    }
    this.friendBlockedSinceSec ??= this.clockSec;
    if (this.clockSec - this.friendBlockedSinceSec >= standInConfig.friendBlockedMoveSec) this.wantsMove = true; // decision 237's moving on
    return false;
  }

  /** The whole squad came back together (4.16): it gets up awake at its spawn, as one getting up alone does (decision 201). */
  getUpWithSquad(): void {
    this.wake();
  }

  /** How fast it is going now (m/s): it speeds up and slows down like a person (4.15). 0 while standing. */
  get speedMps(): number {
    return this.speedNowMps;
  }

  /**
   * Walks along its route toward `destination` at up to `speedMps`, planning a fresh one every so often. With
   * `faceRoute` it faces the way it goes; without, it keeps its facing (backing off while aiming at Rook). It moves like a
   * person (4.15, decision 265): it speeds up from standing and slows down by its role's rates, steers at a point a little
   * ahead along the route so corners become arcs, slows for sharp corners and sharp changes of direction, and slows to a
   * stop by the time it is within `stopWithinM` of the end (where its caller counts it as arrived). Returns false once the
   * walk has failed: no route was found, or it has not got closer to `destination` for a while (a route that stops
   * short of a spot it cannot reach ends that way too).
   */
  private walkRoute(dtSec: number, destination: Vector3, speedMps = this.values.walkSpeedMps, faceRoute = true, stopWithinM = standInConfig.coverArriveM): boolean {
    if (Math.hypot(destination.x - this.walkGoal.x, destination.z - this.walkGoal.z) > standInConfig.coverArriveM) {
      this.walkGoal.copy(destination); // a new goal: start counting afresh
      this.walkClosestM = Infinity;
      this.walkStuckForSec = 0;
    }
    this.repathTimerSec -= dtSec;
    if (this.repathTimerSec <= 0) {
      this.routeFound = this.hooks.findPath(this.feet, destination, this.path);
      this.pathIndex = 1; // the first point is where it stands
      if (this.path.length > 0) this.carrot.copy(this.path[0]);
      this.repathTimerSec = standInConfig.repathIntervalSec;
    }
    this.walkedThisUpdate = true;

    // Where it steers: the carrot, kept a little ahead along the route (further when going faster).
    const lookaheadM = Math.max(standInConfig.lookaheadMinM, this.speedNowMps * standInConfig.lookaheadSec);
    this.advanceCarrot(lookaheadM);
    const toCarrotX = this.carrot.x - this.feet.x;
    const toCarrotZ = this.carrot.z - this.feet.z;
    const toCarrotM = Math.hypot(toCarrotX, toCarrotZ);

    // How fast it should go, then speeding up or slowing down toward that by its role's rates.
    const wantedMps = speedMps * (this.flinching ? standInConfig.flinchSpeedShare : 1);
    let targetMps = 0;
    if (toCarrotM > 1e-6) {
      targetMps = Math.min(wantedMps, this.speedLimitMps(wantedMps, toCarrotM, stopWithinM));
      if (this.speedNowMps > 0) {
        // A sharp change from the way it is moving now (a new route, a turn of the carrot) is a corner right here.
        const turnRad = Math.acos(Math.max(-1, Math.min(1, (this.moveX * toCarrotX + this.moveZ * toCarrotZ) / toCarrotM)));
        targetMps = Math.min(targetMps, Math.max(wantedMps * cornerShare(turnRad), standInConfig.creepSpeedMps));
      }
    }
    const { accelMps2, brakeMps2 } = this.values;
    this.speedNowMps =
      targetMps > this.speedNowMps ? Math.min(targetMps, this.speedNowMps + accelMps2 * dtSec) : Math.max(targetMps, this.speedNowMps - brakeMps2 * dtSec);

    // Its way of moving turns toward the carrot gradually: quickly when slow, slowly when fast (a person must slow down
    // to turn round). From standing it simply sets off toward it. Then it moves on that way; it never passes the end.
    const stepM = this.speedNowMps * dtSec;
    if (stepM > 0 && toCarrotM > 1e-6) {
      const wantX = toCarrotX / toCarrotM;
      const wantZ = toCarrotZ / toCarrotM;
      if (this.moveX === 0 && this.moveZ === 0) {
        this.moveX = wantX;
        this.moveZ = wantZ;
      } else {
        const offRad = Math.atan2(this.moveX * wantZ - this.moveZ * wantX, this.moveX * wantX + this.moveZ * wantZ);
        const maxTurnRad = (standInConfig.turnAccelMps2 / Math.max(this.speedNowMps, standInConfig.creepSpeedMps)) * dtSec;
        const turnRad = Math.max(-maxTurnRad, Math.min(maxTurnRad, offRad));
        const cos = Math.cos(turnRad);
        const sin = Math.sin(turnRad);
        const x = this.moveX * cos - this.moveZ * sin;
        this.moveZ = this.moveX * sin + this.moveZ * cos;
        this.moveX = x;
      }
      if (toCarrotM <= stepM && this.pathIndex >= this.path.length) {
        this.feet.x = this.carrot.x; // the last little bit: onto the end of the route
        this.feet.z = this.carrot.z;
      } else {
        this.feet.x += this.moveX * stepM;
        this.feet.z += this.moveZ * stepM;
      }
      if (faceRoute) this.turnToward(this.moveX, this.moveZ, dtSec);
    }
    this.hooks.pushOut(this.feet); // a safety net: the route already keeps clear of walls
    this.feet.y = this.routeHeightAt(this.feet);
    const toGoalM = this.routeLeftM(destination);
    if (toGoalM < this.walkClosestM - progressStepM) {
      this.walkClosestM = toGoalM;
      this.walkStuckForSec = 0;
    } else {
      this.walkStuckForSec += dtSec;
    }
    return this.routeFound && this.walkStuckForSec < standInConfig.walkStuckSec;
  }

  /** How far is left to walk: along the route (a stair leads away from the goal first), or in a straight line if there is no route. */
  private routeLeftM(destination: Vector3): number {
    if (this.path.length === 0) return Math.hypot(destination.x - this.feet.x, destination.z - this.feet.z);
    let leftM = 0;
    let fromX = this.feet.x;
    let fromZ = this.feet.z;
    for (let i = Math.min(this.pathIndex, this.path.length - 1); i < this.path.length; i++) {
      leftM += Math.hypot(this.path[i].x - fromX, this.path[i].z - fromZ);
      fromX = this.path[i].x;
      fromZ = this.path[i].z;
    }
    return leftM;
  }

  /** The route's height under `at` (a stair or ramp goes up): from the nearest of the few segments around the carrot; its own height if no route. */
  private routeHeightAt(at: Vector3): number {
    let bestM = Infinity;
    let y = at.y;
    for (let i = Math.max(1, this.pathIndex - 2); i <= Math.min(this.pathIndex, this.path.length - 1); i++) {
      const a = this.path[i - 1];
      const b = this.path[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 1e-9 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.z - a.z) * dz) / lenSq)) : 0;
      const m = Math.hypot(a.x + dx * t - at.x, a.z + dz * t - at.z);
      if (m < bestM) {
        bestM = m;
        y = a.y + (b.y - a.y) * t;
      }
    }
    return y;
  }

  /** Moves the carrot on along the route until it is `lookaheadM` from its feet, or at the route's end. It never goes back. */
  private advanceCarrot(lookaheadM: number): void {
    for (let i = 0; i < carrotMaxMoves && this.pathIndex < this.path.length; i++) {
      const aheadM = Math.hypot(this.carrot.x - this.feet.x, this.carrot.z - this.feet.z);
      if (aheadM >= lookaheadM) return;
      const next = this.path[this.pathIndex];
      const leftM = Math.hypot(next.x - this.carrot.x, next.z - this.carrot.z);
      const moveM = lookaheadM - aheadM; // moving it this far along the route adds at most this much
      if (leftM <= moveM) {
        this.carrot.x = next.x;
        this.carrot.z = next.z;
        this.pathIndex++;
      } else {
        this.carrot.x += ((next.x - this.carrot.x) / leftM) * moveM;
        this.carrot.z += ((next.z - this.carrot.z) / leftM) * moveM;
      }
    }
  }

  /**
   * The fastest it may go now and still slow, by its braking, to each corner's speed by that corner, and to a stop by
   * `stopWithinM` from the route's end. Looks a few corners ahead of the carrot.
   */
  private speedLimitMps(wantedMps: number, toCarrotM: number, stopWithinM: number): number {
    const brakeMps2 = this.values.brakeMps2 * brakePlanShare;
    let limitMps = Infinity;
    let distanceM = toCarrotM;
    let fromX = this.carrot.x;
    let fromZ = this.carrot.z;
    let lastX = this.carrot.x - this.feet.x;
    let lastZ = this.carrot.z - this.feet.z;
    const lastIndex = Math.min(this.path.length - 1, this.pathIndex + cornersAhead);
    for (let i = this.pathIndex; i <= lastIndex; i++) {
      const point = this.path[i];
      const segX = point.x - fromX;
      const segZ = point.z - fromZ;
      const segM = Math.hypot(segX, segZ);
      if (segM > 1e-6) {
        // The corner where the last stretch meets this one.
        const lastM = Math.hypot(lastX, lastZ);
        if (lastM > 1e-6) {
          const turnRad = Math.acos(Math.max(-1, Math.min(1, (lastX * segX + lastZ * segZ) / (lastM * segM))));
          const cornerMps = Math.max(wantedMps * cornerShare(turnRad), standInConfig.creepSpeedMps);
          limitMps = Math.min(limitMps, Math.sqrt(cornerMps * cornerMps + 2 * brakeMps2 * Math.max(distanceM - toCarrotM, 0)));
        }
        distanceM += segM;
        lastX = segX;
        lastZ = segZ;
      }
      fromX = point.x;
      fromZ = point.z;
    }
    // The end of the route, if it is within the corners looked at: slow to a stop by `stopWithinM` from it.
    if (lastIndex === this.path.length - 1 || this.pathIndex >= this.path.length) {
      limitMps = Math.min(limitMps, Math.max(Math.sqrt(2 * brakeMps2 * Math.max(distanceM - stopWithinM, 0)), standInConfig.creepSpeedMps));
    }
    return limitMps;
  }

  /**
   * A round aimed at Rook: before first contact it always misses (a warning, enemies.md); after, it hits by the chance
   * from his exposure (times `hitShare`), within the hit budget.
   */
  private aimedShot(hitShare: number): StandInShot {
    if (!this.contacted) return 'miss';
    const hits = this.random() < this.hooks.hitChance(this) * hitShare && this.hooks.mayHit(this); // the squad's hit budget
    if (hits) this.hooks.hitLanded(this);
    return hits ? 'hit' : 'miss';
  }

  private shoot(dtSec: number, hitShare: number): void {
    if (this.needsReload) this.startReload(); // empty: it reloads where it is, or on the move (the heavy), 4.16
    if (this.reloading) return;
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    if (!this.lineClear('hit')) {
      this.cooldownSec = standInConfig.roundIntervalSec; // its own cover (or a squadmate) is in the way: keep aiming, try again (decisions 239, 266)
      return;
    }
    if (!this.takeSlot()) {
      this.cooldownSec = 0; // all firing slots are busy: keep aiming and fire as soon as one is free
      return;
    }
    this.hooks.fire(this, this.aimedShot(hitShare));
    this.roundFired();
    this.roundsInBurst++;
    if (this.roundsInBurst >= this.values.burstRounds) {
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
    this.climbing = false;
    this.setState('approach');
    this.sightTimerSec = 0; // look straight away
    this.coverTimerSec = 0; // and pick cover straight away
    this.seesPlayer = false;
    this.repathTimerSec = 0;
  }

  private die(): void {
    this.climbing = false;
    this.cancelReload();
    this.setState('falling');
    this.leaveCover();
    this.hooks.downed(this);
  }

  private leaveCover(): void {
    this.hooks.releaseCover(this);
    this.coverPoint = null;
  }

  private placeAtSpawn(): void {
    this.leaveCover();
    this.feet.set(this.spawn.xM, 0, this.spawn.zM);
    this.yawRad = this.spawn.yawRad;
    this.health = new Health(this.values.healthPoints);
    this.crouched = false;
    this.engaged = false;
    this.burstsDone = 0;
    this.knowsWhere = false;
    this.lastKnownAgeSec = Infinity;
    this.grenadeSeen = false;
    this.giveSlotBack();
    this.endSuppress();
    this.endThrow(false);
    this.grenadesLeft = Math.max(Math.round(this.values.grenades), 0);
    this.roundsLeft = this.magazineRounds;
    this.reloadLeftSec = 0;
    this.needsReload = false;
    this.friendBlockedSinceSec = null;
    this.moveCover = null;
    this.dropHeldPush();
    this.pinnedByRook = false;
    this.contacted = false;
    this.recentHits.length = 0;
    this.flinchLeftSec = 0;
    this.flinchFreeAtSec = 0;
    this.path.length = 0;
    this.pathIndex = 0;
    this.speedNowMps = 0;
    this.moveX = 0;
    this.moveZ = 0;
  }

  private setState(state: StandInState): void {
    if (this.state === state) return;
    if (this.state === 'flank') this.hooks.flankOver(this); // however a flank ends, the squad hears of it
    if (this.state === 'advance') this.hooks.advanceOver(this); // and an advance
    if (this.state === 'hunt') this.hooks.huntMoveOver(this); // and a hunt move
    this.endSuppress(); // suppressing only lives inside one stay in cover
    this.endThrow(false); // and so does a throw
    this.panicking = false; // panic fire lives inside one run to cover
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
