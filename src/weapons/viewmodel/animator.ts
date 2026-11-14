import { viewmodelConfig as config } from '../../config/viewmodel';
import type { GunId } from '../events';
import type { ViewWeapon } from './models';
import { Spring } from './spring';
import {
  checkPose,
  type CheckPose,
  type CheckShape,
  clamp01,
  easeOutBack,
  grenadeThrowKeys,
  gunInspectKeys,
  type Key,
  inspectChamberCheck,
  knifeSlashKeys,
  rackPose,
  reloadPose,
  sampleKeys,
  segment,
  smooth,
  type RackPose,
  type ReloadPose,
  type ReloadShape,
  type Transform,
} from './timeline';

/** Where every moving part of the held weapon is, as offsets from its rest. Camera space: y up, z toward the player. */
export interface Pose {
  /** The whole weapon. Rotations are in radians; positive pitch lifts the muzzle. */
  x: number;
  y: number;
  z: number;
  pitchRad: number;
  yawRad: number;
  rollRad: number;
  /** The magazine, and whether it is in view. */
  magY: number;
  /** The magazine's sideways and forward offsets and its tilt (a check lifts it up and turns it toward the camera). */
  magX: number;
  magZ: number;
  magPitchRad: number;
  magRollRad: number;
  magVisible: boolean;
  /** The slide (pistol) or bolt (rifle), moved toward the player. */
  slideZ: number;
  /** A brass casing stuck in the ejection port (a jam). */
  stuckCasing: boolean;
  /** The off hand. */
  handX: number;
  handY: number;
  handZ: number;
}

/** What the game tells the animator each frame. The optional ones default to "nothing is happening". */
export interface AnimatorInput {
  /** What is in hand: a weapon, or 'grenade' while one is being thrown. */
  weapon: ViewWeapon;
  /** 0 just after switching to the weapon, 1 when the draw is done. */
  drawProgress: number;
  /** 0 to 1 through a reload, or null when not reloading. */
  reloadProgress: number | null;
  /** The share of the reload that is the rack of an empty gun (0 for a reload with rounds left). */
  reloadRackShare?: number;
  /** 0 to 1 through checking the magazine, or null. */
  checkProgress?: number | null;
  /** 0 to 1 through a grenade throw (while `weapon` is 'grenade'), and the share of it at which the grenade leaves the hand. */
  throwProgress?: number | null;
  throwReleaseShare?: number;
  /** True when the gun is empty: the slide or bolt stays locked back. */
  lockedOpen?: boolean;
  /** True while the gun is jammed: the slide or bolt sits part way back with a casing stuck in the port. */
  jammed?: boolean;
  sprinting: boolean;
  /** 0 at the hip, 1 fully aimed. Walk bob and turning sway get smaller as it rises. */
  aimBlend?: number;
  /** Walking speed for the bob: 0 when still, in the air, sliding or climbing. */
  speedMps?: number;
  crouching?: boolean;
  /** How far the view turned this frame, left and up are positive. For the turning sway. */
  lookYawRad?: number;
  lookPitchRad?: number;
}

export type PreviewKind = 'draw' | 'fire' | 'reload' | 'emptyReload' | 'check' | 'inspect';

// How far back the off hand reaches along the gun to the magazine, and to the slide or bolt to rack it. They differ between
// guns: the pistol's hand already holds the grip by both, the rifle's holds the handguard.
const magazineReachM: Record<GunId, number> = { rifle: 0.26, pistol: 0.04 };
const rackReachM: Record<GunId, number> = { rifle: 0.34, pistol: 0.06 };
const reloadShape: ReloadShape = { handReachM: 0, magDropM: 0, handDipM: 0 }; // filled in each frame
const previewRackShare = 0.2; // how much of an "empty reload" preview is the rack
const inspectBusyAim = 0.05; // aiming even a little cancels an inspect
const bobSmoothingPerSec = 10; // how fast the bob fades in and out when starting or stopping
const notStarted = Infinity;

/** Eases `value` toward +/- `limit` without ever passing it (nearly unchanged when small). */
const softLimit = (value: number, limit: number): number => (limit <= 0 ? 0 : limit * Math.tanh(value / limit));

// Works out the weapon's pose from what the game is doing: drawing, shooting, reloading, checking, inspecting,
// sprinting, walking and turning. Springs give the snap; the draw, reload and check follow the real timers, so they
// take exactly as long as the rules say. No drawing code here.
export class ViewmodelAnimator {
  readonly pose: Pose = {
    x: 0, y: 0, z: 0, pitchRad: 0, yawRad: 0, rollRad: 0,
    magY: 0, magX: 0, magZ: 0, magPitchRad: 0, magRollRad: 0, magVisible: true, slideZ: 0, stuckCasing: false, handX: 0, handY: 0, handZ: 0,
  };

  private readonly kickBack = new Spring(config.kickFrequencyHz, config.kickDampingRatio);
  private readonly kickUp = new Spring(config.kickFrequencyHz, config.kickDampingRatio);
  private readonly swayYaw = new Spring(config.swayFrequencyHz, config.swayDampingRatio);
  private readonly swayPitch = new Spring(config.swayFrequencyHz, config.swayDampingRatio);
  private readonly reload: ReloadPose = { handX: 0, handY: 0, handZ: 0, magY: 0, magVisible: true, tilt: 0 };
  private readonly check: CheckPose = { handX: 0, handY: 0, handZ: 0, magY: 0, magVisible: true, tilt: 0, magX: 0, magZ: 0, magPitchRad: 0, magRollRad: 0 };
  private readonly checkShape: CheckShape = { handReachM: 0, magPullM: 0, liftUpM: 0, liftSideM: 0, liftTowardM: 0, magTiltRad: 0, magRollRad: 0 };
  private readonly rack: RackPose = { slideShare: 0, handY: 0, handZ: 0 };
  private readonly keyed: Transform = { x: 0, y: 0, z: 0, pitchRad: 0, yawRad: 0, rollRad: 0 };
  private sinceShotSec = notStarted;
  private sinceSwingSec = notStarted;
  private sinceRackSec = notStarted;
  private inspectSec: number | null = null;
  private sprintBlend = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private weapon: ViewWeapon = 'rifle';
  private throwKeys: { releaseShare: number; keys: readonly Key[] } = { releaseShare: -1, keys: [] };
  private preview: { kind: PreviewKind; timeSec: number; durationSec: number } | null = null;

  /** A round left a gun: kick it back and cycle the slide or bolt. */
  fired(weapon: GunId): void {
    this.kickBack.impulse(weapon === 'rifle' ? config.rifleKickBackM : config.pistolKickBackM);
    this.kickUp.impulse(weapon === 'rifle' ? config.rifleKickUpRad : config.pistolKickUpRad);
    this.sinceShotSec = 0;
    this.inspectSec = null;
  }

  /** One fast rack while clearing a jam. */
  racked(): void {
    this.sinceRackSec = 0;
    this.inspectSec = null;
  }

  /** The knife was swung. */
  swung(): void {
    this.sinceSwingSec = 0;
    this.inspectSec = null;
  }

  /** Start inspecting the weapon (F held). Ignored if something else is going on; the next update decides. */
  inspect(): void {
    this.inspectSec = 0;
  }

  /** Dev panel: play one animation on its own, taking `durationSec`, whatever the game is doing. */
  playPreview(kind: PreviewKind, durationSec: number): void {
    if (kind === 'fire') {
      if (this.weapon === 'knife') this.swung();
      else if (this.weapon !== 'grenade') this.fired(this.weapon);
    } else if (kind === 'inspect') {
      this.inspect();
    } else {
      this.preview = { kind, timeSec: 0, durationSec: Math.max(durationSec, 0.05) };
    }
  }

  update(dtSec: number, input: AnimatorInput): void {
    if (input.weapon !== this.weapon) this.resetMotion();
    this.weapon = input.weapon;
    // Slow motion slows the motion we drive ourselves (kicks, previews, inspect); the real timers cannot be slowed.
    const motionDtSec = dtSec * config.slowMotionScale;
    const isKnife = input.weapon === 'knife';
    const gun: GunId | null = input.weapon === 'knife' || input.weapon === 'grenade' ? null : input.weapon;

    this.kickBack.frequencyHz = this.kickUp.frequencyHz = config.kickFrequencyHz;
    this.kickBack.dampingRatio = this.kickUp.dampingRatio = config.kickDampingRatio;
    this.kickBack.update(motionDtSec);
    this.kickUp.update(motionDtSec);
    this.sinceShotSec += motionDtSec;
    this.sinceSwingSec += motionDtSec;
    this.sinceRackSec += motionDtSec;

    // Sprint pose eases in and out over its time.
    const sprintStep = dtSec / Math.max(config.sprintPoseTimeSec, 0.01);
    this.sprintBlend = clamp01(this.sprintBlend + (input.sprinting ? sprintStep : -sprintStep));
    const sprint = smooth(this.sprintBlend);

    // The animations the rules drive, or a preview standing in for them.
    let drawProgress = input.drawProgress;
    let reloadProgress = input.reloadProgress;
    let rackShare = input.reloadRackShare ?? 0;
    let checkProgress = input.checkProgress ?? null;
    if (this.preview) {
      this.preview.timeSec += motionDtSec;
      const progress = this.preview.timeSec / this.preview.durationSec;
      const kind = this.preview.kind;
      if (progress >= 1) this.preview = null;
      else if (kind === 'draw') drawProgress = progress;
      else if (kind === 'check') checkProgress = progress;
      else {
        reloadProgress = progress;
        rackShare = kind === 'emptyReload' ? previewRackShare : 0;
      }
    }
    const lockedOpen = (input.lockedOpen ?? false) || this.preview?.kind === 'emptyReload';

    // An inspect gives way to anything else going on, and plays once.
    const busy =
      reloadProgress !== null || checkProgress !== null || drawProgress < 1 || input.sprinting || (input.aimBlend ?? 0) > inspectBusyAim;
    if (this.inspectSec !== null) {
      this.inspectSec += motionDtSec;
      const lengthSec = isKnife ? config.inspectKnifeSec : config.inspectGunSec;
      if (busy || this.inspectSec >= lengthSec) this.inspectSec = null;
    }

    const pose = this.pose;
    const draw = easeOutBack(clamp01(drawProgress), config.drawOvershoot);

    // Base pose: draw, kick, sprint.
    pose.x = sprint * config.sprintOffsetXM;
    pose.y = sprint * config.sprintOffsetYM - config.drawLowerM * (1 - draw);
    pose.z = this.kickBack.value + sprint * config.sprintOffsetZM;
    pose.pitchRad = this.kickUp.value + sprint * config.sprintPitchRad + config.drawTiltRad * (1 - draw);
    pose.yawRad = sprint * config.sprintYawRad;
    pose.rollRad = sprint * config.sprintRollRad;
    pose.handX = pose.handY = pose.handZ = pose.magY = 0;
    pose.magX = pose.magZ = pose.magPitchRad = pose.magRollRad = 0;
    pose.magVisible = true;

    this.addBobAndSway(dtSec, input, pose);

    // The slide or bolt: cycles on a shot, and stays locked back when the gun is empty.
    const slideTravelM = gun === null ? 0 : gun === 'rifle' ? config.rifleBoltBackM : config.pistolSlideBackM;
    pose.slideZ = this.slideOffset(slideTravelM, lockedOpen);
    pose.stuckCasing = gun !== null && (input.jammed ?? false);
    if (pose.stuckCasing) pose.slideZ = slideTravelM * config.jammedSlideShare;
    if (gun !== null) {
      // Each tap that clears a jam: the off hand reaches back and the slide or bolt is pulled and let go, fast.
      const rack = this.sinceRackSec / Math.max(config.rackTapSec, 0.01);
      if (rack < 1) {
        const bump = Math.sin(Math.PI * rack);
        pose.slideZ = Math.max(pose.slideZ, slideTravelM * bump);
        pose.handZ = rackReachM[gun] * bump;
        pose.handY = 0.02 * bump;
      }
    }

    if (gun !== null && reloadProgress !== null) {
      // A reload with an empty chamber ends with a rack: the first part is the magazine swap, the last part the rack.
      const swapEnd = 1 - rackShare;
      const swap = swapEnd > 0 ? clamp01(reloadProgress / swapEnd) : 1;
      reloadShape.handReachM = magazineReachM[gun];
      reloadShape.magDropM = config.magDropM;
      reloadShape.handDipM = config.handDipM;
      reloadPose(swap, reloadShape, this.reload);
      pose.handX = this.reload.handX;
      pose.handY = this.reload.handY;
      pose.handZ = this.reload.handZ;
      pose.magY = this.reload.magY;
      pose.magVisible = this.reload.magVisible;
      pose.pitchRad += this.reload.tilt * config.reloadTiltRad;
      pose.rollRad += this.reload.tilt * config.reloadTiltRad;
      if (rackShare > 0 && reloadProgress >= swapEnd) {
        rackPose(clamp01((reloadProgress - swapEnd) / rackShare), rackReachM[gun], this.rack);
        pose.handY = this.rack.handY;
        pose.handZ = this.rack.handZ;
        pose.slideZ = slideTravelM * this.rack.slideShare;
      }
    } else if (gun !== null && checkProgress !== null) {
      const shape = this.checkShape;
      shape.handReachM = magazineReachM[gun];
      shape.magPullM = config.checkMagPullM;
      shape.liftUpM = config.checkLiftUpM;
      shape.liftSideM = config.checkLiftSideM;
      shape.liftTowardM = config.checkLiftTowardM;
      shape.magTiltRad = config.checkMagTiltRad;
      shape.magRollRad = config.checkMagRollRad;
      checkPose(checkProgress, shape, this.check);
      pose.handX = this.check.handX;
      pose.handY = this.check.handY;
      pose.handZ = this.check.handZ;
      pose.magY = this.check.magY;
      pose.magX = this.check.magX;
      pose.magZ = this.check.magZ;
      pose.magPitchRad = this.check.magPitchRad;
      pose.magRollRad = this.check.magRollRad;
      pose.rollRad += this.check.tilt * config.checkRollRad;
    } else if (this.inspectSec !== null) {
      this.addInspect(pose, gun, slideTravelM);
    }

    // The grenade throw: up with the pin pulled, back, forward through the release, away.
    if (input.weapon === 'grenade') {
      const releaseShare = input.throwReleaseShare ?? 0.5;
      if (this.throwKeys.releaseShare !== releaseShare) this.throwKeys = { releaseShare, keys: grenadeThrowKeys(releaseShare) };
      sampleKeys(this.throwKeys.keys, clamp01(input.throwProgress ?? 0), this.keyed);
      this.addTransform(pose, this.keyed);
    }

    // The knife swing: wind back, slash across, recover.
    if (isKnife) {
      const swing = this.sinceSwingSec / Math.max(config.knifeSlashSec, 0.01);
      if (swing < 1) {
        sampleKeys(knifeSlashKeys, swing, this.keyed);
        this.addTransform(pose, this.keyed);
      }
    }
  }

  /** Walking sways the weapon side to side and up and down; turning makes it lag a little behind the view. */
  private addBobAndSway(dtSec: number, input: AnimatorInput, pose: Pose): void {
    const aim = input.aimBlend ?? 0;
    const speedMps = input.speedMps ?? 0;

    const bobTarget = clamp01(speedMps / Math.max(config.bobReferenceSpeedMps, 0.1));
    this.bobAmount += (bobTarget - this.bobAmount) * (1 - Math.exp(-bobSmoothingPerSec * dtSec));
    this.bobPhase += (speedMps / Math.max(config.bobStrideM, 0.1)) * 2 * Math.PI * dtSec;
    const bobScale = this.bobAmount * (input.crouching ? config.bobCrouchScale : 1) * (1 - aim * (1 - config.bobAimScale));
    pose.x += Math.sin(this.bobPhase) * config.bobSideM * bobScale;
    pose.y += Math.sin(2 * this.bobPhase) * config.bobUpM * bobScale;

    this.swayYaw.frequencyHz = this.swayPitch.frequencyHz = config.swayFrequencyHz;
    this.swayYaw.dampingRatio = this.swayPitch.dampingRatio = config.swayDampingRatio;
    // A turn pushes the weapon the opposite way; the spring brings it back. Less while aiming.
    const gain = config.swayGain * (1 - aim * (1 - config.swayAimScale));
    this.swayYaw.velocity -= (input.lookYawRad ?? 0) * gain;
    this.swayPitch.velocity -= (input.lookPitchRad ?? 0) * gain;
    this.swayYaw.update(dtSec);
    this.swayPitch.update(dtSec);
    // A soft limit: the lag eases toward its largest instead of stopping dead against it, so a long turn does not end abruptly.
    pose.yawRad += softLimit(this.swayYaw.value, config.swayMaxRad);
    pose.pitchRad += softLimit(this.swayPitch.value, config.swayMaxRad);
  }

  /** The inspect: a gun is turned over and the chamber checked; the knife is flipped. */
  private addInspect(pose: Pose, gun: GunId | null, slideTravelM: number): void {
    const lengthSec = gun === null ? config.inspectKnifeSec : config.inspectGunSec;
    const t = clamp01((this.inspectSec ?? 0) / Math.max(lengthSec, 0.01));
    if (gun === null) {
      // The knife is tossed up and flipped end over end.
      const lift = Math.sin(Math.PI * segment(t, 0.1, 0.9));
      pose.y += 0.04 * lift;
      pose.pitchRad += 4 * Math.PI * smooth(segment(t, 0.15, 0.85)) + 0.3 * lift;
      return;
    }
    sampleKeys(gunInspectKeys, t, this.keyed);
    this.addTransform(pose, this.keyed);
    const check = inspectChamberCheck(t);
    pose.slideZ = Math.max(pose.slideZ, slideTravelM * check);
    pose.handZ = rackReachM[gun] * check;
  }

  private addTransform(pose: Pose, transform: Transform): void {
    pose.x += transform.x;
    pose.y += transform.y;
    pose.z += transform.z;
    pose.pitchRad += transform.pitchRad;
    pose.yawRad += transform.yawRad;
    pose.rollRad += transform.rollRad;
  }

  /** The slide or bolt: quickly back, then forward, after each shot. Stays back when the gun is empty. */
  private slideOffset(travelM: number, lockedOpen: boolean): number {
    if (travelM === 0) return 0;
    const t = this.sinceShotSec;
    if (t < config.slideBackSec) return travelM * smooth(segment(t, 0, config.slideBackSec));
    if (lockedOpen) return travelM;
    return travelM * (1 - smooth(segment(t, config.slideBackSec, config.slideBackSec + config.slideForwardSec)));
  }

  /** Switching weapon starts from rest: no leftover kick from the other one. */
  private resetMotion(): void {
    this.kickBack.reset();
    this.kickUp.reset();
    this.swayYaw.reset();
    this.swayPitch.reset();
    this.sinceShotSec = notStarted;
    this.sinceSwingSec = notStarted;
    this.sinceRackSec = notStarted;
    this.inspectSec = null;
    this.preview = null;
  }
}
