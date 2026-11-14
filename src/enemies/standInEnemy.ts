import { Vector3 } from 'three';
import { standInConfig } from '../config/standInEnemy';
import { hearsNoise, type Noise } from '../stealth/noise';
import type { HitZone } from './dummy';
import { Health } from './health';
import type { Target } from './target';

export type StandInState = 'idle' | 'approach' | 'shoot' | 'falling' | 'down';

/** How the stand-in touches the world. The game gives it real rays and collision; tests give it fakes. */
export interface StandInHooks {
  /** True if nothing solid is between its eyes and Rook. */
  canSeePlayer(enemy: StandInEnemy): boolean;
  /** Pushes its feet out of walls and props, so it slides along them. Changes `feet`. */
  pushOut(feet: Vector3): void;
  /** One round leaves its gun; `hits` says whether it lands on Rook (decided here, at the moment of firing). */
  fire(enemy: StandInEnemy, hits: boolean): void;
}

const degToRad = Math.PI / 180;

// A temporary enemy (milestone 4.1, decision 197): it walks straight at Rook and shoots, only to prove damage, health and
// death. It breaks the "no enemy walks mindlessly" rule on purpose; pathfinding (4.2), cover (4.3), peeking (4.4) and the
// miss model (4.5) replace it. It starts idle, wakes on a noise it hears or a hit, and from then on always knows where
// Rook is. No drawing code here.
export class StandInEnemy implements Target {
  /** Where its feet are. It stays on the floor. */
  readonly feet = new Vector3();
  /** Which way it faces; 0 faces north (-z), like the player's yaw. */
  yawRad = 0;
  health = new Health(standInConfig.healthPoints);
  state: StandInState = 'idle';
  /** Dev panel testing aid: stands still and holds fire (it can still be shot and fall). */
  frozen = false;
  private stateSec = 0;
  private seesPlayer = false;
  private sightTimerSec = 0;
  /** Time until the next round may fire (the reaction pause, then the gaps within and between bursts). */
  private cooldownSec = 0;
  private roundsInBurst = 0;
  /** Game time since the last damaging hit, for the hit budget. */
  private sinceHitSec = Infinity;
  private readonly ears = new Vector3();

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

  get hittable(): boolean {
    return this.state !== 'falling' && this.state !== 'down';
  }

  get awake(): boolean {
    return this.state === 'approach' || this.state === 'shoot';
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
    this.ears.set(this.feet.x, standInConfig.eyeHeightM, this.feet.z);
    if (hearsNoise(noise, this.ears)) this.wake();
  }

  hit(zone: HitZone, bodyDamage: number): boolean {
    if (!this.hittable) return false;
    if (zone === 'head') return this.kill();
    const killed = this.health.damage(bodyDamage);
    if (killed) this.setState('falling');
    else if (this.state === 'idle') this.wake();
    return killed;
  }

  kill(): boolean {
    if (!this.hittable) return false;
    const killed = this.health.kill();
    if (killed) this.setState('falling');
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
    const dx = player.x - this.feet.x;
    const dz = player.z - this.feet.z;
    const distanceM = Math.hypot(dx, dz);
    const facingErrorRad = this.turnToward(dx, dz, dtSec);

    if (this.seesPlayer && distanceM <= standInConfig.stopRangeM) {
      if (this.state !== 'shoot') {
        this.setState('shoot');
        this.cooldownSec = standInConfig.reactionSec;
        this.roundsInBurst = 0;
      }
      // The reaction pause only counts down once it faces Rook, so it never fires sideways.
      if (facingErrorRad <= standInConfig.aimToleranceDeg * degToRad) this.shoot(dtSec);
      return;
    }

    this.setState('approach');
    if (distanceM > standInConfig.closestM) {
      const stepM = Math.min(standInConfig.walkSpeedMps * dtSec, distanceM - standInConfig.closestM);
      this.feet.x += (dx / distanceM) * stepM;
      this.feet.z += (dz / distanceM) * stepM;
      this.hooks.pushOut(this.feet);
      this.feet.y = 0;
    }
  }

  private shoot(dtSec: number): void {
    this.cooldownSec -= dtSec;
    if (this.cooldownSec > 0) return;
    // shortcut: the hit budget is kept per enemy; the squad coordinator (4.6) shares it across every enemy.
    const hits = this.random() < standInConfig.hitChance && this.sinceHitSec >= standInConfig.hitGapSec;
    if (hits) this.sinceHitSec = 0;
    this.hooks.fire(this, hits);
    this.roundsInBurst++;
    if (this.roundsInBurst >= standInConfig.burstRounds) {
      this.roundsInBurst = 0;
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
    this.seesPlayer = false;
  }

  private placeAtSpawn(): void {
    this.feet.set(this.spawn.xM, 0, this.spawn.zM);
    this.yawRad = this.spawn.yawRad;
    this.health = new Health(standInConfig.healthPoints);
    this.sinceHitSec = Infinity;
  }

  private setState(state: StandInState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateSec = 0;
  }
}
