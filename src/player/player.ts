import * as THREE from 'three';
import { inputConfig } from '../config/input';
import { playerConfig } from '../config/player';
import type { Input } from '../core/input';
import type { LevelCollision } from '../level/collision';
import { HeadPlacer } from './head';
import { easeToward, limitLean, rollForLean, wantedLean } from './lean';
import { LedgeProbe, Mantle, type Spot } from './mantle';
import { accelerate, steerToward, wishDirection, type Vec2 } from './movement';
import { StanceMachine, type Stance } from './stance';

const stanceSizes: Record<Stance, { heightM: number; eyeHeightM: number }> = {
  standing: { heightM: playerConfig.heightM, eyeHeightM: playerConfig.eyeHeightM },
  crouching: { heightM: playerConfig.crouchHeightM, eyeHeightM: playerConfig.crouchEyeHeightM },
  sliding: { heightM: playerConfig.slideHeightM, eyeHeightM: playerConfig.slideEyeHeightM },
};

// The player: position, walking, stance, climbing, looking and the camera. Movement runs on the fixed update;
// looking runs every screen frame so turning feels immediate.
export class Player {
  /** Feet position. */
  readonly position = new THREE.Vector3(playerConfig.startXM, 0, playerConfig.startZM);
  readonly stance = new StanceMachine();
  readonly mantle = new Mantle();

  /** True when standing on the floor or on something. */
  grounded = true;

  private readonly previousPosition = this.position.clone();
  private readonly velocity: Vec2 = { x: 0, z: 0 };
  private velocityYMps = 0;
  private readonly wish: Vec2 = { x: 0, z: 0 };
  private readonly slideDirection: Vec2 = { x: 0, z: -1 };
  private readonly mouseMove = { x: 0, y: 0 };
  private readonly mantleSpot: Spot = { x: 0, y: 0, z: 0 };
  private yawRad = playerConfig.startYawRad;
  private pitchRad = 0;
  private eyeHeightM: number = playerConfig.eyeHeightM;
  private previousEyeHeightM: number = playerConfig.eyeHeightM;
  /** Sideways camera shift from leaning: positive is right. Only the head moves; the body stays put. */
  private leanOffsetM = 0;
  private previousLeanOffsetM = 0;
  private readonly head: HeadPlacer;
  private readonly ledges: LedgeProbe;
  private readonly headPosition = new THREE.Vector3();
  private readonly leanOrigin = new THREE.Vector3();
  private readonly leanDirection = new THREE.Vector3();

  constructor(private readonly collision: LevelCollision) {
    this.head = new HeadPlacer(collision);
    this.ledges = new LedgeProbe(collision);
  }

  get isSprinting(): boolean {
    return this.stance.sprinting && !this.mantle.active;
  }

  /** One fixed-rate update: read the keys, pick a stance, move, fall, climb, get pushed out of walls. */
  fixedUpdate(dtSec: number, input: Input): void {
    this.previousPosition.copy(this.position);
    this.previousEyeHeightM = this.eyeHeightM;
    this.previousLeanOffsetM = this.leanOffsetM;

    // Always consume presses, so a tap that did nothing is not remembered for later.
    const spacePressed = input.consumePress('Space');
    const crouchPressed = input.consumePress('KeyC');

    if (spacePressed && this.grounded && !this.mantle.active && this.stance.stance !== 'sliding') this.tryStartMantle();

    if (this.mantle.active) {
      this.updateMantle(dtSec, input);
    } else {
      this.updateWalking(dtSec, input, crouchPressed);
    }

    // The camera eases toward the stance's eye height instead of snapping, so crouching looks smooth.
    const ease = 1 - Math.exp(-dtSec / playerConfig.eyeSmoothingTimeSec);
    this.eyeHeightM += (stanceSizes[this.stance.stance].eyeHeightM - this.eyeHeightM) * ease;

    this.updateLean(dtSec, input);
  }

  private updateWalking(dtSec: number, input: Input, crouchPressed: boolean): void {
    const forward = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
    const right = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
    wishDirection(forward, right, this.yawRad, this.wish);

    // Standing up needs room. Only asked when not already standing.
    const canStand =
      this.stance.stance === 'standing' ||
      !this.collision.overlapsCapsule(this.position, playerConfig.capsuleRadiusM, playerConfig.heightM, playerConfig.clearanceToleranceM);

    // this.velocity still holds last update's real movement, after walls.
    this.stance.update(
      {
        crouchHeld: input.isKeyDown('KeyC'),
        crouchPressed,
        sprintHeld: input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight'),
        forwardInput: forward,
        canStand,
      },
      dtSec,
      Math.hypot(this.velocity.x, this.velocity.z),
    );

    if (this.stance.slideStarted) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.slideDirection.x = this.velocity.x / speed;
      this.slideDirection.z = this.velocity.z / speed;
    }

    if (this.stance.stance === 'sliding') {
      steerToward(this.slideDirection, this.wish, playerConfig.slideSteerRateRadPerSec * dtSec);
      this.velocity.x = this.slideDirection.x * this.stance.slideSpeedMps;
      this.velocity.z = this.slideDirection.z * this.stance.slideSpeedMps;
    } else {
      const maxSpeedMps = this.stance.sprinting
        ? playerConfig.sprintSpeedMps
        : this.stance.stance === 'crouching'
          ? playerConfig.crouchSpeedMps
          : playerConfig.moveSpeedMps;
      accelerate(this.velocity, this.wish, maxSpeedMps, playerConfig.accelerationMps2, playerConfig.brakingMps2, dtSec);
    }

    this.position.x += this.velocity.x * dtSec;
    this.position.z += this.velocity.z * dtSec;

    // Gravity. The floor is height 0; props push the capsule up (standing on them) or down (a ceiling).
    this.velocityYMps = Math.max(this.velocityYMps - playerConfig.gravityMps2 * dtSec, -playerConfig.maxFallSpeedMps);
    this.position.y += this.velocityYMps * dtSec;
    const size = stanceSizes[this.stance.stance];
    const contact = this.collision.pushOut(this.position, playerConfig.capsuleRadiusM, size.heightM, playerConfig.collisionIterations, true);
    if (this.position.y < 0) {
      this.position.y = 0;
      this.grounded = true;
      this.velocityYMps = 0;
    } else if (contact.up) {
      this.grounded = true;
      this.velocityYMps = 0;
    } else {
      this.grounded = false;
      if (contact.down && this.velocityYMps > 0) this.velocityYMps = 0;
    }

    // Speed is whatever movement survived the walls, so pressing into a wall does not store up speed.
    this.velocity.x = (this.position.x - this.previousPosition.x) / dtSec;
    this.velocity.z = (this.position.z - this.previousPosition.z) / dtSec;
  }

  /** Space: look for a ledge in front and start climbing or vaulting if there is one. */
  private tryStartMantle(): void {
    const plan = this.ledges.probe(this.position, this.yawRad, stanceSizes[this.stance.stance].heightM);
    if (!plan) return;
    this.mantle.start(this.position, plan, this.velocity);
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.velocityYMps = 0;
  }

  private updateMantle(dtSec: number, input: Input): void {
    this.mantle.update(dtSec, input.isKeyDown('Space'), this.mantleSpot);
    this.position.set(this.mantleSpot.x, this.mantleSpot.y, this.mantleSpot.z);
    if (!this.mantle.active) {
      // Done: a vault carries its speed on, a climb ends standing still.
      this.velocity.x = this.mantle.exitVelocity.x;
      this.velocity.z = this.mantle.exitVelocity.z;
      this.velocityYMps = 0;
      this.grounded = true;
    }
  }

  /** Q and E lean the head sideways, never into a wall. No leaning while sprinting, sliding or climbing. */
  private updateLean(dtSec: number, input: Input): void {
    const allowed = !this.mantle.active && !this.stance.sprinting && this.stance.stance !== 'sliding';
    const wanted = wantedLean(input.isKeyDown('KeyQ'), input.isKeyDown('KeyE'), allowed);
    // Check the side being leaned toward, or the side still leaned out to while returning to centre.
    const side = wanted !== 0 ? wanted : Math.sign(this.leanOffsetM);

    let wallDistanceM = Infinity;
    if (side !== 0) {
      this.leanOrigin.set(this.position.x, this.position.y + this.eyeHeightM, this.position.z);
      this.leanDirection.set(Math.cos(this.yawRad) * side, 0, -Math.sin(this.yawRad) * side);
      const reachM = playerConfig.leanDistanceM + playerConfig.cameraClearanceM;
      wallDistanceM = this.collision.rayDistance(this.leanOrigin, this.leanDirection, reachM);
    }

    const clearanceM = playerConfig.cameraClearanceM;
    const targetM = limitLean(wanted * playerConfig.leanDistanceM, side, wallDistanceM, clearanceM);
    const easedM = easeToward(this.leanOffsetM, targetM, dtSec, playerConfig.leanSmoothingTimeSec);
    // Walking toward a wall while leaned cuts the lean back at once; it is never allowed through.
    this.leanOffsetM = limitLean(easedM, side, wallDistanceM, clearanceM);
  }

  /** Turn with the mouse. Called once per screen frame. */
  look(input: Input): void {
    input.consumeMouseMove(this.mouseMove);
    this.yawRad -= this.mouseMove.x * inputConfig.mouseSensitivityRadPerPx;
    this.pitchRad -= this.mouseMove.y * inputConfig.mouseSensitivityRadPerPx;
    this.pitchRad = Math.max(-inputConfig.pitchLimitRad, Math.min(inputConfig.pitchLimitRad, this.pitchRad));
  }

  /** Place the camera. `alpha` blends between the last two updates so motion is smooth on fast screens. */
  applyToCamera(camera: THREE.PerspectiveCamera, alpha: number): void {
    const wantedLeanM = this.previousLeanOffsetM + (this.leanOffsetM - this.previousLeanOffsetM) * alpha;
    const feetY = this.previousPosition.y + (this.position.y - this.previousPosition.y) * alpha;
    // The head position is checked against walls every frame with this frame's facing, so turning cannot clip it into one.
    const leanM = this.head.place(
      this.previousPosition.x + (this.position.x - this.previousPosition.x) * alpha,
      this.previousPosition.z + (this.position.z - this.previousPosition.z) * alpha,
      feetY + this.previousEyeHeightM + (this.eyeHeightM - this.previousEyeHeightM) * alpha,
      this.yawRad,
      wantedLeanM,
      this.headPosition,
    );
    camera.position.copy(this.headPosition);
    camera.rotation.set(
      this.pitchRad,
      this.yawRad,
      rollForLean(leanM, playerConfig.leanDistanceM, playerConfig.leanRollRad),
      'YXZ',
    );
  }
}
