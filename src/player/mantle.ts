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
  vaultMinSpeedMps: number;
  vaultMinSec: number;
  vaultMaxSec: number;
  vaultArcHeightM: number;
  vaultArcMinHeightM: number;
  vaultHoldDecisionSec: number;
  climbLowSec: number;
  climbRiseSec: number;
  climbTopSec: number;
  mantleMinHeightM: number;
  vaultMaxHeightM: number;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);

type Phase = 'vault' | 'toTop' | 'rise' | 'forward';

// The scripted move. Collision is off while it runs, because the end spot was checked when it started.
//  - Vault (low cover): ONE smooth arc, forward and up a little at the same time, at the speed the player came in with,
//    landing on the far side. In first person only the camera shows, so the feet only need to lift a little, not to the
//    obstacle's height. A tap vaults; if Space is still held a moment in, the move turns into climbing onto the obstacle.
//  - Climbing onto low cover: eases from wherever the player is, up and onto the top.
//  - Tall climb: rise to the top, then onto it (unchanged).
export class Mantle {
  active = false;
  /** Speed to carry on with after the move: the entry speed after a vault, zero otherwise. */
  readonly exitVelocity = { x: 0, z: 0 };

  private plan: MantlePlan | null = null;
  /** Where the current phase started. Moves when a vault turns into a climb. */
  private readonly from: Spot = { x: 0, y: 0, z: 0 };
  /** Where the player was at the last update. */
  private readonly current: Spot = { x: 0, y: 0, z: 0 };
  private entrySpeedMps = 0;
  private elapsedSec = 0;
  private phase: Phase = 'vault';
  private holdDecided = false;
  // Vault arc, worked out when the move starts.
  private vaultSec = 0;
  private vaultLinearWeight = 1;
  private vaultArcM = 0;
  private vaultDirX = 0;
  private vaultDirZ = 0;

  constructor(private readonly settings: MantleSettings = playerConfig) {}

  start(feet: Spot, plan: MantlePlan, entryVelocity: { x: number; z: number }): void {
    const s = this.settings;
    this.plan = plan;
    this.from.x = this.current.x = feet.x;
    this.from.y = this.current.y = feet.y;
    this.from.z = this.current.z = feet.z;
    this.entrySpeedMps = Math.hypot(entryVelocity.x, entryVelocity.z);
    this.elapsedSec = 0;
    this.holdDecided = false;
    this.active = true;
    this.exitVelocity.x = 0;
    this.exitVelocity.z = 0;

    if (plan.band === 'high') {
      this.phase = 'rise';
    } else if (plan.over) {
      this.phase = 'vault';
      const dx = plan.over.x - feet.x;
      const dz = plan.over.z - feet.z;
      const distanceM = Math.hypot(dx, dz);
      this.vaultDirX = dx / distanceM;
      this.vaultDirZ = dz / distanceM;
      // Cross at the speed we came in with, so there is no stop or jerk; a standing start is slower and eases in.
      const speed = Math.max(this.entrySpeedMps, s.vaultMinSpeedMps);
      this.vaultSec = Math.min(Math.max(distanceM / speed, s.vaultMinSec), s.vaultMaxSec);
      this.vaultLinearWeight = clamp01(this.entrySpeedMps / s.vaultMinSpeedMps);
      // A higher obstacle gets a bigger lift, between the two limits.
      const heightFraction = clamp01((plan.topYM - feet.y - s.mantleMinHeightM) / (s.vaultMaxHeightM - s.mantleMinHeightM));
      this.vaultArcM = lerp(s.vaultArcMinHeightM, s.vaultArcHeightM, heightFraction);
    } else {
      this.phase = 'toTop'; // too deep to go over: climb onto it instead
    }
  }

  /** Advances the move and writes where the feet are now into `out`. */
  update(dtSec: number, spaceHeld: boolean, out: Spot): void {
    const plan = this.plan;
    if (!this.active || !plan) return;
    this.elapsedSec += dtSec;

    if (this.phase === 'vault') this.updateVault(plan, spaceHeld, out);
    if (this.phase === 'toTop') this.updateToTop(plan, out);
    else if (this.phase === 'rise') this.updateRise(plan, out);
    else if (this.phase === 'forward') this.updateForward(plan, out);

    this.current.x = out.x;
    this.current.y = out.y;
    this.current.z = out.z;
  }

  private updateVault(plan: MantlePlan, spaceHeld: boolean, out: Spot): void {
    const over = plan.over;
    if (!over) return; // cannot happen: a vault phase always has a landing

    // A moment in, decide between going over (tap) and climbing onto the obstacle (Space still held).
    if (!this.holdDecided && this.elapsedSec >= this.settings.vaultHoldDecisionSec) {
      this.holdDecided = true;
      if (spaceHeld && plan.onTop) {
        this.phase = 'toTop';
        this.from.x = this.current.x;
        this.from.y = this.current.y;
        this.from.z = this.current.z;
        this.elapsedSec = 0;
        return; // update() carries on with the toTop phase this same frame
      }
    }

    const t = Math.min(this.elapsedSec / this.vaultSec, 1);
    const along = this.vaultLinearWeight * t + (1 - this.vaultLinearWeight) * smooth(t);
    out.x = lerp(this.from.x, over.x, along);
    out.z = lerp(this.from.z, over.z, along);
    // sin squared: zero slope at both ends and the highest point in the middle, so the lift neither pops nor drops.
    out.y = lerp(this.from.y, over.y, smooth(t)) + this.vaultArcM * Math.sin(Math.PI * t) ** 2;

    if (t >= 1) {
      // Land exactly on the landing spot (the arc's maths leaves a tiny residue).
      out.x = over.x;
      out.y = over.y;
      out.z = over.z;
      this.active = false;
      this.exitVelocity.x = this.vaultDirX * this.entrySpeedMps;
      this.exitVelocity.z = this.vaultDirZ * this.entrySpeedMps;
    }
  }

  /** Eases from where the player is, up and onto the top: rises first, the forward part overlaps the end of the rise. */
  private updateToTop(plan: MantlePlan, out: Spot): void {
    const end = plan.onTop;
    if (!end) {
      this.active = false; // cannot happen for a plan from LedgeProbe; stop rather than move to nowhere
      return;
    }
    const t = Math.min(this.elapsedSec / this.settings.climbLowSec, 1);
    out.y = lerp(this.from.y, end.y, easeOut(clamp01(t / 0.7)));
    const forward = smooth(clamp01((t - 0.25) / 0.75));
    out.x = lerp(this.from.x, end.x, forward);
    out.z = lerp(this.from.z, end.z, forward);
    if (t >= 1) this.active = false;
  }

  /** Tall climb, first part: straight up to the top. */
  private updateRise(plan: MantlePlan, out: Spot): void {
    const riseSec = this.settings.climbRiseSec;
    if (this.elapsedSec < riseSec) {
      out.x = this.from.x;
      out.z = this.from.z;
      out.y = lerp(this.from.y, plan.topYM, easeOut(this.elapsedSec / riseSec));
      return;
    }
    this.elapsedSec -= riseSec;
    this.phase = 'forward';
    this.updateForward(plan, out);
  }

  /** Tall climb, second part: onto the top. */
  private updateForward(plan: MantlePlan, out: Spot): void {
    const end = plan.onTop;
    if (!end) {
      this.active = false;
      return;
    }
    const t = Math.min(this.elapsedSec / this.settings.climbTopSec, 1);
    out.x = lerp(this.from.x, end.x, smooth(t));
    out.z = lerp(this.from.z, end.z, smooth(t));
    out.y = lerp(plan.topYM, end.y, t);
    if (t >= 1) this.active = false;
  }
}
