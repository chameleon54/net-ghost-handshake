// Weapon animation tuning (milestone 2.5). All starting values, to be readjusted by feel. Units are in the names.
// Offsets are in the camera's space: x right, y up, z toward the player (so a gun kicking back moves +z).
export const viewmodelConfigDefaults = {
  // The spring that settles the gun after a kick: higher frequency is snappier, damping ratio 1 means no overshoot.
  kickFrequencyHz: 14,
  kickDampingRatio: 0.45,
  // Per shot: how far the gun jumps back and how far the muzzle flips up.
  rifleKickBackM: 0.03,
  rifleKickUpRad: 0.05,
  pistolKickBackM: 0.045,
  pistolKickUpRad: 0.14,

  // Cycling the slide (pistol) or bolt (rifle) on a shot.
  rifleBoltBackM: 0.035,
  pistolSlideBackM: 0.05,
  slideBackSec: 0.04,
  slideForwardSec: 0.07,

  // Draw: the gun rises from below and tilts into place, with a little overshoot.
  drawLowerM: 0.28,
  drawTiltRad: 0.7,
  drawOvershoot: 1.6,

  // Sprint pose: the gun is lowered and angled across.
  sprintPoseTimeSec: 0.18,
  sprintOffsetXM: -0.03,
  sprintOffsetYM: -0.12,
  sprintOffsetZM: 0.03,
  sprintPitchRad: -0.25,
  sprintYawRad: 0.6,
  sprintRollRad: -0.3,

  // Reload: the off hand takes the magazine out, dips out of frame and brings a new one.
  magDropM: 0.28,
  handDipM: 0.32,
  reloadTiltRad: 0.25,

  // Clearing a jam: each tap of R is one fast rack. While jammed the slide or bolt sits part way back.
  rackTapSec: 0.18,
  jammedSlideShare: 0.45,

  // A hot barrel (the heat values come from each gun's config): the smoke puffs.
  smokeEverySecAtStart: 0.35,
  smokeEverySecAtMaxHeat: 0.07,
  smokeLifeSec: 1.2,
  smokeRiseMps: 0.25,
  smokeSizeM: 0.03,
  smokeGrowth: 3,
  smokeOpacity: 0.35,

  // Checking the magazine (hold R): Rook takes it out, lifts it up and to the left and tips it toward the camera to look at it.
  // Offsets are in the gun's own space (x right, y up, z toward the player).
  checkMagPullM: 0.07,
  checkLiftUpM: 0.22,
  checkLiftSideM: 0.12,
  checkLiftTowardM: 0.1,
  checkMagTiltRad: 1.1,
  checkMagRollRad: 0.3,
  /** The gun itself only leans this much while the magazine is checked. */
  checkRollRad: 0.08,
  /** The HUD's floating picture sits this far from the magazine on screen (x right, y up, in metres at the weapon's distance). */
  magPictureOffsetXM: -0.07,
  magPictureOffsetYM: 0.02,

  // Inspecting (hold F).
  inspectGunSec: 2.6,
  inspectKnifeSec: 1.6,

  // The knife swing.
  knifeSlashSec: 0.22,

  // Walking: the weapon sways side to side and bobs up and down, less when crouched or aiming.
  bobStrideM: 4,
  bobSideM: 0.006,
  bobUpM: 0.008,
  bobReferenceSpeedMps: 4,
  bobCrouchScale: 0.5,
  bobAimScale: 0.2,

  // Turning: the weapon lags a little behind the view, then catches up. Less when aiming.
  swayGain: 100,
  swayFrequencyHz: 15,
  swayDampingRatio: 0.85,
  swayMaxRad: 0.06,
  swayAimScale: 0.3,

  /** Slow motion for the dev panel's animation previews and kicks (1 is normal). */
  slowMotionScale: 1,
} as const;

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export type ViewmodelConfig = { -readonly [K in keyof typeof viewmodelConfigDefaults]: number };
export const viewmodelConfig: ViewmodelConfig = { ...viewmodelConfigDefaults };
