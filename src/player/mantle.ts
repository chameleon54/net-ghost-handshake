import { Vector3 } from 'three';
import { playerConfig } from '../config/player';
import type { LevelCollision } from '../level/collision';

// Climbing and vaulting (Space). Two parts, both free of browser code:
//  - LedgeProbe looks in front of the player with a few raycasts and says what can be done there.
//  - Mantle is the short scripted move itself.

export interface Spot {
  x: number;
  y: number;
  z: number;
}

export interface MantlePlan {
  /** Low (up to the vault height: can be vaulted or climbed onto) or high (climb only). */
  band: 'low' | 'high';
  /** Height of the top surface. */
  topYM: number;
  /** Where the feet end up when standing on top, or null if the top is too narrow or blocked. */
  onTop: Spot | null;
  /** Where the feet land after a vault, or null if it cannot be vaulted. */
  over: Spot | null;
}

export interface ProbeSettings {
  capsuleRadiusM: number;
  clearanceToleranceM: number;
  mantleReachM: number;
  mantleMinHeightM: number;
  vaultMaxHeightM: number;
  climbMaxHeightM: number;
  vaultMaxDepthM: number;
  climbMinTopDepthM: number;
  mantleProbeStepM: number;
  vaultLandingMarginM: number;
}

const down = new Vector3(0, -1, 0);
const flatTopToleranceM = 0.05;

export class LedgeProbe {
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly spot = new Vector3();

  constructor(
    private readonly collision: LevelCollision,
    private readonly settings: ProbeSettings = playerConfig,
  ) {}

  /** What can be done in front of a player standing at `feet` and looking along `yawRad`, or null for nothing. */
  probe(feet: Vector3, yawRad: number, capsuleHeightM: number): MantlePlan | null {
    const s = this.settings;
    const fx = -Math.sin(yawRad);
    const fz = -Math.cos(yawRad);

    // 1. Is something within reach, low down in front of the player?
    const lowRayY = feet.y + s.mantleMinHeightM / 2;
    const reachM = s.capsuleRadiusM + s.mantleReachM;
    const nearFaceM = this.sideways(feet.x, lowRayY, feet.z, fx, fz, reachM, false);
    if (nearFaceM === Infinity) return null;
    // What is in front must be something Space may climb. A wall (not climbable) in front, even with a climbable
    // prop behind it, means nothing happens.
    if (this.sideways(feet.x, lowRayY, feet.z, fx, fz, reachM, true) > nearFaceM + flatTopToleranceM) return null;

    // 2. Is it still in the way above the climb limit? Then it is a wall: nothing to do.
    const tallRayY = feet.y + s.climbMaxHeightM + flatTopToleranceM;
    if (this.sideways(feet.x, tallRayY, feet.z, fx, fz, nearFaceM + 0.1, false) !== Infinity) return null;

    // 3. How high is its top?
    const topYM = this.surfaceY(feet.x + fx * (nearFaceM + flatTopToleranceM), feet.z + fz * (nearFaceM + flatTopToleranceM), tallRayY, s.climbMaxHeightM + 0.1, true);
    if (topYM === null) return null;
    const heightM = topYM - feet.y;
    if (heightM < s.mantleMinHeightM || heightM > s.climbMaxHeightM + flatTopToleranceM) return null;
    const band = heightM <= s.vaultMaxHeightM ? 'low' : 'high';

    // 4. How deep is the flat top? Count rays that still land on it, stepping away from the player.
    const maxSamples = Math.ceil((s.vaultMaxDepthM + s.mantleProbeStepM) / s.mantleProbeStepM);
    let samples = 0;
    for (let i = 0; i < maxSamples; i++) {
      const alongM = nearFaceM + flatTopToleranceM + i * s.mantleProbeStepM;
      const y = this.surfaceY(feet.x + fx * alongM, feet.z + fz * alongM, topYM + 0.3, 0.4, true);
      if (y === null || Math.abs(y - topYM) > flatTopToleranceM) break;
      samples++;
    }
    const depthM = samples * s.mantleProbeStepM;

    // 5. Can the player stand on top?
    let onTop: Spot | null = null;
    if (depthM >= s.climbMinTopDepthM - 1e-6) {
      const centreM = nearFaceM + Math.min(depthM / 2, s.capsuleRadiusM + 0.1);
      const spot = { x: feet.x + fx * centreM, y: topYM, z: feet.z + fz * centreM };
      if (!this.blocked(spot, capsuleHeightM)) onTop = spot;
    }

    // 6. Can the player go over it, to a clear spot on the far side?
    let over: Spot | null = null;
    if (band === 'low' && depthM > 0 && depthM <= s.vaultMaxDepthM + 1e-6) {
      const landingM = nearFaceM + depthM + s.capsuleRadiusM + s.vaultLandingMarginM;
      const lx = feet.x + fx * landingM;
      const lz = feet.z + fz * landingM;
      // No prop under the landing spot means the floor, at height 0.
      const groundY = this.surfaceY(lx, lz, topYM + 0.3, topYM + 0.4, false) ?? 0;
      const spot = { x: lx, y: groundY, z: lz };
      const levelEnough = groundY <= feet.y + 0.3 && groundY >= feet.y - 0.5;
      if (levelEnough && !this.blocked(spot, capsuleHeightM)) over = spot;
    }

    if (band === 'low' ? onTop || over : onTop) return { band, topYM, onTop, over };
    return null;
  }

  /** Distance to the first thing along a flat direction, or Infinity. */
  private sideways(x: number, y: number, z: number, dx: number, dz: number, maxM: number, climbableOnly: boolean): number {
    this.origin.set(x, y, z);
    this.direction.set(dx, 0, dz);
    return this.collision.rayDistance(this.origin, this.direction, maxM, climbableOnly);
  }

  /** Height of the first surface straight below (x, fromY, z), or null if none within `maxDropM`. Tops use climbable parts only. */
  private surfaceY(x: number, z: number, fromY: number, maxDropM: number, climbableOnly: boolean): number | null {
    this.origin.set(x, fromY, z);
    const distance = this.collision.rayDistance(this.origin, down, maxDropM, climbableOnly);
    return distance === Infinity ? null : fromY - distance;
  }

  private blocked(feet: Spot, capsuleHeightM: number): boolean {
    this.spot.set(feet.x, feet.y, feet.z);
    return this.collision.overlapsCapsule(this.spot, this.settings.capsuleRadiusM, capsuleHeightM, this.settings.clearanceToleranceM);
  }
}

export interface MantleSettings {
  vaultRiseSec: number;
  vaultOverSec: number;
  climbLowTopSec: number;
  climbRiseSec: number;
  climbTopSec: number;
  vaultApexClearanceM: number;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// The scripted move. Collision is off while it runs, because the end spot was checked when it started.
// Rise first; at the top, a low obstacle goes over unless Space is still held (then the player stays on top).
export class Mantle {
  active = false;
  /** Speed to carry on with after the move: the entry speed after a vault, zero otherwise. */
  readonly exitVelocity = { x: 0, z: 0 };

  private plan: MantlePlan | null = null;
  private readonly from: Spot = { x: 0, y: 0, z: 0 };
  private entrySpeedMps = 0;
  private elapsedSec = 0;
  private rising = true;
  private goOnTop = false;
  private apexYM = 0;

  constructor(private readonly settings: MantleSettings = playerConfig) {}

  start(feet: Spot, plan: MantlePlan, entryVelocity: { x: number; z: number }): void {
    this.plan = plan;
    this.from.x = feet.x;
    this.from.y = feet.y;
    this.from.z = feet.z;
    this.entrySpeedMps = Math.hypot(entryVelocity.x, entryVelocity.z);
    this.elapsedSec = 0;
    this.rising = true;
    this.active = true;
    this.exitVelocity.x = 0;
    this.exitVelocity.z = 0;
    this.apexYM = plan.topYM + (plan.band === 'low' ? this.settings.vaultApexClearanceM : 0);
  }

  /** Advances the move and writes where the feet are now into `out`. */
  update(dtSec: number, spaceHeld: boolean, out: Spot): void {
    const plan = this.plan;
    if (!this.active || !plan) return;
    const s = this.settings;
    this.elapsedSec += dtSec;

    if (this.rising) {
      const riseSec = plan.band === 'low' ? s.vaultRiseSec : s.climbRiseSec;
      if (this.elapsedSec < riseSec) {
        out.x = this.from.x;
        out.z = this.from.z;
        out.y = lerp(this.from.y, this.apexYM, easeOut(this.elapsedSec / riseSec));
        return;
      }
      // At the top: decide between going over and staying on top.
      this.elapsedSec -= riseSec;
      this.rising = false;
      this.goOnTop = plan.band === 'high' || plan.over === null || (spaceHeld && plan.onTop !== null);
    }

    const end = this.goOnTop ? plan.onTop : plan.over;
    if (!end) {
      this.active = false; // cannot happen for a plan from LedgeProbe; stop rather than move to nowhere
      return;
    }
    const forwardSec = this.goOnTop ? (plan.band === 'low' ? s.climbLowTopSec : s.climbTopSec) : s.vaultOverSec;
    const t = Math.min(this.elapsedSec / forwardSec, 1);
    out.x = lerp(this.from.x, end.x, smooth(t));
    out.z = lerp(this.from.z, end.z, smooth(t));
    out.y = lerp(this.apexYM, end.y, this.goOnTop ? t : easeIn(t));

    if (t >= 1) {
      this.active = false;
      if (!this.goOnTop) {
        const dx = end.x - this.from.x;
        const dz = end.z - this.from.z;
        const length = Math.hypot(dx, dz);
        this.exitVelocity.x = (dx / length) * this.entrySpeedMps;
        this.exitVelocity.z = (dz / length) * this.entrySpeedMps;
      }
    }
  }
}
