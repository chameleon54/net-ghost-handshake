import { checkHoldProgress } from '../checkTiming';

// Pure motion curves for the weapon animations. Each takes a progress number and gives positions; no drawing code,
// so they can be tested. Progress goes from 0 (start) to 1 (end); the curves start and end at rest so nothing pops.

export const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);

/** How far `t` is through the stretch from `start` to `end`, as 0 to 1. */
export const segment = (t: number, start: number, end: number): number => clamp01((t - start) / (end - start));

/** Smooth start and end. */
export const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Speeds up as it goes, like something falling. */
export const easeIn = (t: number): number => t * t;

/** Slows down as it arrives. */
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Goes past 1 and settles back to 1: the overshoot of a snappy draw. `overshoot` of 1.7 is the classic amount. */
export function easeOutBack(t: number, overshoot: number): number {
  const c = overshoot + 1;
  const u = t - 1;
  return 1 + c * u * u * u + overshoot * u * u;
}

// ---- Reload ----

/** Distances that differ between guns. */
export interface ReloadShape {
  /** How far back the off hand reaches along the gun to the magazine (the pistol's hand is already there). */
  handReachM: number;
  /** How far the magazine falls when it drops out. */
  magDropM: number;
  /** How far the off hand dips down, out of frame, to fetch the new magazine. */
  handDipM: number;
}

/** The parts of a reload. Offsets are from the parts' rest places, in camera space (y up, z toward the player). */
export interface ReloadPose {
  handX: number;
  handY: number;
  handZ: number;
  magY: number;
  magVisible: boolean;
  /** 0 to 1: how far the gun is tilted to show the magazine well. */
  tilt: number;
}

// Where each stage of a reload ends, as a share of the whole reload time.
const reachEnd = 0.15;
const dropEnd = 0.3;
const dipEnd = 0.55;
const carryEnd = 0.8;
const seatEnd = 0.92;
const handSideM = 0.06; // the hand swings out to the side while it dips
const handLiftM = 0.02; // the hand sits a touch below the magazine well while reaching it
const seatPushM = 0.015; // the magazine is pushed in this much further than it rests, as it clicks in

export function reloadPose(progress: number, shape: ReloadShape, out: ReloadPose): void {
  const reach = smooth(segment(progress, 0, reachEnd));
  const drop = easeIn(segment(progress, reachEnd, dropEnd));
  const dip = smooth(segment(progress, dropEnd, dipEnd));
  const carry = easeOut(segment(progress, dipEnd, carryEnd));
  const seat = smooth(segment(progress, carryEnd, seatEnd));
  const away = smooth(segment(progress, seatEnd, 1)); // 0 while the hand is at the magazine, 1 when it is back home

  // The hand: reach to the magazine, dip away, come back below the well, then return to its rest grip.
  const atMag = reach * (1 - away);
  out.handZ = shape.handReachM * atMag;
  out.handY = -handLiftM * atMag - (shape.handDipM - handLiftM) * dip * (1 - carry) * (1 - away);
  out.handX = handSideM * dip * (1 - carry) * (1 - away);

  // The magazine: falls out, is gone while the hand fetches a new one, then rises in with the hand and is pushed home.
  out.magVisible = progress < dropEnd || progress >= dipEnd;
  if (progress < dropEnd) out.magY = -shape.magDropM * drop;
  else out.magY = out.handY + handLiftM * atMag - (shape.magDropM * 0.5) * (1 - carry) - seatPushM * seat * (1 - away);

  // The gun tilts to show the well from the start of the reach until just before the end.
  out.tilt = smooth(segment(progress, 0, reachEnd)) * (1 - smooth(segment(progress, carryEnd, 1)));
}

// ---- Keyframed poses (inspect, knife slash) ----

/** Where the whole weapon is, as offsets from its rest. */
export interface Transform {
  x: number;
  y: number;
  z: number;
  pitchRad: number;
  yawRad: number;
  rollRad: number;
}

export interface Key extends Transform {
  /** When this key is reached, as a share of the whole animation (0 to 1). */
  t: number;
}

/** Moves smoothly from key to key. Before the first key and after the last it holds still. Keys must be in time order. */
export function sampleKeys(keys: readonly Key[], t: number, out: Transform): void {
  let from = keys[0];
  let to = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1].t) {
      from = keys[i];
      to = keys[i + 1];
      break;
    }
  }
  const u = t <= keys[0].t ? 0 : t >= keys[keys.length - 1].t ? 1 : smooth(segment(t, from.t, to.t));
  out.x = from.x + (to.x - from.x) * u;
  out.y = from.y + (to.y - from.y) * u;
  out.z = from.z + (to.z - from.z) * u;
  out.pitchRad = from.pitchRad + (to.pitchRad - from.pitchRad) * u;
  out.yawRad = from.yawRad + (to.yawRad - from.yawRad) * u;
  out.rollRad = from.rollRad + (to.rollRad - from.rollRad) * u;
}

const at = (t: number, x: number, y: number, z: number, pitchRad: number, yawRad: number, rollRad: number): Key => ({ t, x, y, z, pitchRad, yawRad, rollRad });

/** A gun is inspected: raised toward the eyes, turned to show each side, tipped up, then the chamber is checked. */
export const gunInspectKeys: readonly Key[] = [
  at(0, 0, 0, 0, 0, 0, 0),
  at(0.15, -0.06, 0.04, 0.06, 0.1, 0, 0.7),
  at(0.38, -0.07, 0.05, 0.07, 0.1, 0.5, -0.8),
  at(0.62, -0.05, 0.04, 0.05, 0.6, 0.2, 0.1),
  at(0.8, -0.04, 0.03, 0.05, 0.15, -0.2, 0.5),
  at(1, 0, 0, 0, 0, 0, 0),
];

/** The chamber check inside the inspect: the slide or bolt is pulled back and let go. Returns 0 to 1 and back to 0. */
export const inspectChamberCheck = (t: number): number => Math.sin(Math.PI * segment(t, 0.66, 0.8));

/** The knife swing: wind back and up to the right, slash down across to the left, recover. */
export const knifeSlashKeys: readonly Key[] = [
  at(0, 0, 0, 0, 0, 0, 0),
  at(0.25, 0.06, 0.05, 0.04, 0.3, 0.5, -0.9),
  at(0.55, -0.14, -0.06, -0.14, -0.45, -0.9, 0.9),
  at(1, 0, 0, 0, 0, 0, 0),
];

/**
 * The grenade throw: the hand comes up with the pin pulled, goes back, swings forward through the release, and drops
 * away. `releaseShare` is the share of the throw at which the grenade leaves the hand, so the swing meets it.
 */
export function grenadeThrowKeys(releaseShare: number): readonly Key[] {
  const r = Math.min(Math.max(releaseShare, 0.1), 0.9);
  return [
    at(0, 0, -0.2, 0.05, 0.6, 0, 0),
    at(r * 0.3, 0, 0, 0, 0.2, 0, 0),
    at(r * 0.9, 0.04, 0.06, 0.1, 0.7, 0, 0.2),
    at(r + (1 - r) * 0.35, -0.03, -0.02, -0.3, -0.5, 0, -0.1),
    at(1, 0, -0.22, -0.05, -0.2, 0, 0),
  ];
}

// ---- Checking the magazine ----

/** The distances and angles of a check. Offsets are in the gun's own space: x right, y up, z toward the player. */
export interface CheckShape {
  /** How far back the off hand reaches along the gun to the magazine. */
  handReachM: number;
  /** How far the magazine slides down out of the well before it is lifted. */
  magPullM: number;
  /** Where the lifted magazine is held, from where it sits in the gun: up, to the left (toward the middle of the screen), toward the camera. */
  liftUpM: number;
  liftSideM: number;
  liftTowardM: number;
  /** How far the held magazine is tipped so its top faces the camera, and how far it leans toward the middle of the screen. */
  magTiltRad: number;
  magRollRad: number;
}

/** The parts of a check: a reload's fields, plus the magazine's sideways, forward and tilt offsets. */
export interface CheckPose extends ReloadPose {
  magX: number;
  magZ: number;
  magPitchRad: number;
  magRollRad: number;
}

// The check's stages overlap, so the magazine never stops between them: it only stands still at the start, while held
// up (at `checkHoldProgress`, where the gun rules freeze the check while R is down), and when seated. Each stage uses
// smootherstep, which is gentler at both ends than smoothstep.
const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const checkHandReachEnd = 0.2;
const checkHandReleaseFrom = 0.9;
const checkSlideOutFrom = 0.1;
const checkSlideOutTo = 0.4;
const checkLiftFrom = 0.25;
const checkLowerTo = 0.85;
const checkSeatFrom = 0.7;
const checkSeatTo = 0.95;

/**
 * Checking the magazine: the off hand reaches back and grabs it, it slides out of the well and, before it has stopped, is
 * lifted up and to the left and tipped toward the camera. It stays there (the gun rules hold the progress at
 * `checkHoldProgress` while R is down), then it is lowered, tipped back, put into the well and pushed home in one flowing
 * move. The hand carries it. Starts and ends at rest.
 */
export function checkPose(progress: number, shape: CheckShape, out: CheckPose): void {
  const hold = checkHoldProgress;
  const reach = smoother(segment(progress, 0, checkHandReachEnd)) * (1 - smoother(segment(progress, checkHandReleaseFrom, 1)));
  const slidOut = smoother(segment(progress, checkSlideOutFrom, checkSlideOutTo)) * (1 - smoother(segment(progress, checkSeatFrom, checkSeatTo)));
  const lift = smoother(segment(progress, checkLiftFrom, hold)) * (1 - smoother(segment(progress, hold, checkLowerTo)));

  out.magY = -shape.magPullM * slidOut * (1 - lift) + shape.liftUpM * lift;
  out.magX = -shape.liftSideM * lift;
  out.magZ = shape.liftTowardM * lift;
  out.magPitchRad = shape.magTiltRad * lift;
  out.magRollRad = shape.magRollRad * lift;
  out.magVisible = true;
  // The hand holds the magazine, wherever it is.
  out.handX = out.magX;
  out.handY = -handLiftM * reach + out.magY;
  out.handZ = shape.handReachM * reach + out.magZ;
  // The gun itself only leans a little, so the magazine is the thing that moves.
  out.tilt = smoother(segment(progress, 0, 0.4)) * (1 - smoother(segment(progress, hold, 1)));
}

// ---- Racking the slide or bolt (the end of an empty reload) ----

export interface RackPose {
  /** How far back the slide or bolt is, as a share of its full travel (1 = locked open). */
  slideShare: number;
  handY: number;
  handZ: number;
}

/** The off hand reaches back, pulls the slide a little further, and lets it snap forward. Starts and ends at rest. */
export function rackPose(progress: number, handReachM: number, out: RackPose): void {
  const bump = smooth(segment(progress, 0, 0.3)) * (1 - smooth(segment(progress, 0.75, 1)));
  out.handZ = handReachM * bump;
  out.handY = handLiftM * bump;
  out.slideShare = 1 - smooth(segment(progress, 0.4, 0.6)) + 0.15 * Math.sin(Math.PI * segment(progress, 0.2, 0.45));
}
