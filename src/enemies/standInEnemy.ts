import { Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import { standInConfig } from '../config/standInEnemy';
import type { CoverPoint } from '../level/cover';
import { hearsNoise, type Noise } from '../stealth/noise';
import type { HitZone } from './dummy';
import { Health } from './health';
import type { Target } from './target';

/**
 * `approach`: walking (to its cover, or straight for Rook when no cover hides it). `cover`: at its cover spot, holding.
 * `fight`: standing where it is, firing at Rook (he is close, or its cover failed). `retreat`: backing off to new cover
 * while firing. `shoot`: standing in the open firing, only when no cover hides it (the 4.1 behaviour).
 */
export type StandInState = 'idle' | 'approach' | 'cover' | 'fight' | 'retreat' | 'shoot' | 'falling' | 'down';

/** How the stand-in touches the world. The game gives it real rays, navigation and cover; tests give it fakes. */
export interface StandInHooks {
  /** True if nothing solid is between its eyes and Rook. */
  canSeePlayer(enemy: StandInEnemy): boolean;
  /** Pushes its feet out of walls and props, so it slides along them. Changes `feet`. */
  pushOut(feet: Vector3): void;
  /** A walkable route from `from` to `to`, written into `out` (the first point is the start). Leaves `out` empty if there is none. */
  findPath(from: Vector3, to: Vector3, out: Vector3[]): boolean;
  /** One round leaves its gun; `hits` says whether it lands on Rook (decided here, at the moment of firing). */
  fire(enemy: StandInEnemy, hits: boolean): void;
  /** The best free cover spot that hides it from Rook, claimed for it (its old one let go), or null if none hides it. */
  pickCover(enemy: StandInEnemy): CoverPoint | null;
  /** True if this spot still hides a body from Rook where he is now. */
  coverHides(point: CoverPoint): boolean;
  /** Lets go of the spot it holds. */
  releaseCover(enemy: StandInEnemy): void;
}

const degToRad = Math.PI / 180;

// A temporary enemy (milestone 4.1, decision 197), growing step by step into the real one. It starts idle, wakes on a
// noise it hears or a hit, and from then on always knows where Rook is. It follows routes on the navigation mesh (4.2).
// Since 4.3 it goes to the best cover that hides it from Rook and holds there, crouched behind low cover. It does not run
// from a fight (decisions 209 and 210): seen up close, it stands and fires, then backs off to new cover still firing; if
// its cover fails at range it answers with a burst before moving. Peeking out to fire is 4.4. If no cover hides it, it
// falls back to heading for Rook and firing when it sees him. No drawing code here.
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
  /** Game time since the last damaging hit, for the hit budget. */
  private sinceHitSec = Infinity;
  private readonly ears = new Vector3();
  private readonly path: Vector3[] = [];
  /** The point of `path` it is walking to. */
  private pathIndex = 0;
  private repathTimerSec = 0;
  private coverPoint: CoverPoint | null = null;
  private coverTimerSec = 0;
  private readonly coverSpot = new Vector3();

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
    return this.crouched ? standInConfig.crouchHeightM : dummyConfig.heightM;
  }

  get eyeHeightNowM(): number {
    return this.crouched ? standInConfig.crouchEyeHeightM : standInConfig.eyeHeightM;
  }

  get muzzleHeightNowM(): number {
    return this.crouched ? standInConfig.crouchMuzzleHeightM : standInConfig.muzzleHeightM;
  }

  /** The cover spot it holds or is walking to, or null. */
  get cover(): CoverPoint | null {
    return this.coverPoint;
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
    if (this.state !== 'approach' && this.state !== 'retreat') return out;
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

  /** A noise Rook made: if it carries to its ears, it wakes up. */
  hear(noise: Noise): void {
    if (this.state !== 'idle') return;
    this.ears.set(this.feet.x, this.eyeHeightNowM, this.feet.z);
    if (hearsNoise(noise, this.ears)) this.wake();
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
    this.stateSec += dtSec;
    this.sinceHitSec += dtSec;
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
    // Seen up close, it stands and fights instead of running (decision 209).
    if (this.coverPoint && this.seesPlayer && distanceM <= standInConfig.standGroundM) {
      this.beginFight();
      this.fight(dtSec, dx, dz, distanceM);
      return;
    }

    if (this.coverPoint) {
      const toCoverM = Math.hypot(this.coverSpot.x - this.feet.x, this.coverSpot.z - this.feet.z);
      if (toCoverM > standInConfig.coverArriveM) {
        this.startWalking();
        this.walkRoute(dtSec, this.coverSpot);
        return;
      }
      // At its spot: crouch behind low cover, face the cover, and fire only if it can see Rook from here.
      this.setState('cover');
      this.crouched = this.coverPoint.height === 'low';
      if (this.seesPlayer) this.engage(dtSec, dx, dz, standInConfig.hitChance);
      else {
        this.engaged = false;
        this.turnToward(-Math.sin(this.coverPoint.facingYawRad), -Math.cos(this.coverPoint.facingYawRad), dtSec);
      }
      return;
    }

    // No cover hides it: the 4.1 behaviour. Head for Rook, and stop to fire once it sees him within range.
    if (this.seesPlayer && distanceM <= standInConfig.stopRangeM) {
      this.setState('shoot');
      this.engage(dtSec, dx, dz, standInConfig.hitChance);
      return;
    }
    this.startWalking();
    if (distanceM > standInConfig.closestM) this.walkRoute(dtSec, player);
  }

  /**
   * Every so often: if it has no cover, or its spot no longer hides it, it picks the best spot (maybe none). If its spot
   * fails while it can see Rook, it answers with a fight first instead of walking off (decision 209).
   */
  private checkCover(dtSec: number): void {
    if (this.state === 'fight' || this.state === 'retreat') return; // those pick their own next spot
    this.coverTimerSec -= dtSec;
    if (this.coverTimerSec > 0) return;
    this.coverTimerSec = standInConfig.coverCheckIntervalSec;
    if (this.coverPoint && this.hooks.coverHides(this.coverPoint)) return; // it stays while its spot works
    if (this.state === 'cover' && this.seesPlayer) {
      this.beginFight();
      return;
    }
    const next = this.hooks.pickCover(this);
    if (next !== this.coverPoint) this.setCover(next);
  }

  private setCover(next: CoverPoint | null): void {
    this.coverPoint = next;
    if (next) this.coverSpot.set(next.xM, 0, next.zM);
    this.repathTimerSec = 0; // a fresh route to the new spot
  }

  /** Stands up where it is to fight. */
  private beginFight(): void {
    this.setState('fight');
    this.crouched = false;
    this.burstsDone = 0;
  }

  /**
   * Fights where it stands. It always finishes a burst, and fires at least one. Then, if Rook is close, it keeps on for
   * the fight time and backs off to new cover still firing; if he is further away, it walks to new cover. With nowhere
   * to go, it keeps fighting. If it loses sight of him it stops and finds cover.
   */
  private fight(dtSec: number, dx: number, dz: number, distanceM: number): void {
    if (!this.seesPlayer) {
      this.leaveFight();
      return;
    }
    this.engage(dtSec, dx, dz, standInConfig.hitChance);
    if (this.roundsInBurst !== 0 || this.burstsDone === 0) return; // never leaves mid-burst, and always answers
    const close = distanceM <= standInConfig.standGroundM;
    if (close && this.stateSec < standInConfig.fightSec) return;
    const next = this.hooks.pickCover(this);
    this.setCover(next);
    if (!next) {
      this.stateSec = 0; // nowhere to go: fight on, and look again after another round of fighting
      this.burstsDone = 0;
      return;
    }
    if (close) this.setState('retreat');
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
    this.walkRoute(dtSec, this.coverSpot, standInConfig.walkSpeedMps * standInConfig.retreatSpeedShare, !firing);
    if (firing) this.engage(dtSec, dx, dz, standInConfig.hitChance * standInConfig.retreatHitChanceShare);
    else this.engaged = false;
  }

  /** Out of the fight (it lost sight of Rook): find cover again straight away. */
  private leaveFight(): void {
    this.coverTimerSec = 0;
    this.startWalking();
  }

  /** Turns to Rook and fires bursts with `hitChance` per round, after the reaction pause the first time it sees him. */
  private engage(dtSec: number, dx: number, dz: number, hitChance: number): void {
    if (!this.engaged) {
      this.engaged = true;
      this.cooldownSec = standInConfig.reactionSec;
      this.roundsInBurst = 0;
    }
    // The reaction pause only counts down once it faces Rook, so it never fires sideways.
    const facingErrorRad = this.turnToward(dx, dz, dtSec);
    if (facingErrorRad <= standInConfig.aimToleranceDeg * degToRad) this.shoot(dtSec, hitChance);
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
   * faces the way it goes; without, it keeps its facing (backing off while aiming at Rook).
   */
  private walkRoute(dtSec: number, destination: Vector3, speedMps = standInConfig.walkSpeedMps, faceRoute = true): void {
    this.repathTimerSec -= dtSec;
    if (this.repathTimerSec <= 0) {
      this.hooks.findPath(this.feet, destination, this.path);
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
  }

  private shoot(dtSec: number, hitChance: number): void {
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    // shortcut: the hit budget is kept per enemy; the squad coordinator (4.6) shares it across every enemy.
    const hits = this.random() < hitChance && this.sinceHitSec >= standInConfig.hitGapSec;
    if (hits) this.sinceHitSec = 0;
    this.hooks.fire(this, hits);
    this.roundsInBurst++;
    if (this.roundsInBurst >= standInConfig.burstRounds) {
      this.roundsInBurst = 0;
      this.burstsDone++;
      this.cooldownSec += standInConfig.burstPauseSec;
    } else {
      this.cooldownSec += standInConfig.roundIntervalSec;
    }
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
    this.sinceHitSec = Infinity;
    this.path.length = 0;
    this.pathIndex = 0;
  }

  private setState(state: StandInState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateSec = 0;
  }
}
