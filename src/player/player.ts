import * as THREE from 'three';
import { inputConfig } from '../config/input';
import { playerConfig } from '../config/player';
import type { Input } from '../core/input';
import type { LevelCollision } from '../level/collision';
import { accelerate, wishDirection, type Vec2 } from './movement';

// The player: position, walking, looking and the camera. Walking runs on the fixed update;
// looking runs every screen frame so turning feels immediate.
export class Player {
  /** Feet position. */
  readonly position = new THREE.Vector3(playerConfig.startXM, 0, playerConfig.startZM);

  private readonly previousPosition = this.position.clone();
  private readonly velocity: Vec2 = { x: 0, z: 0 };
  private readonly wish: Vec2 = { x: 0, z: 0 };
  private readonly mouseMove = { x: 0, y: 0 };
  private yawRad = playerConfig.startYawRad;
  private pitchRad = 0;

  constructor(private readonly collision: LevelCollision) {}

  /** One fixed-rate update: read the keys, walk, get pushed out of walls. */
  fixedUpdate(dtSec: number, input: Input): void {
    this.previousPosition.copy(this.position);

    const forward = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
    const right = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
    wishDirection(forward, right, this.yawRad, this.wish);
    accelerate(
      this.velocity,
      this.wish,
      playerConfig.moveSpeedMps,
      playerConfig.accelerationMps2,
      playerConfig.brakingMps2,
      dtSec,
    );

    this.position.x += this.velocity.x * dtSec;
    this.position.z += this.velocity.z * dtSec;
    this.collision.pushOut(
      this.position,
      playerConfig.capsuleRadiusM,
      playerConfig.heightM,
      playerConfig.collisionIterations,
    );

    // Speed is whatever movement survived the walls, so pressing into a wall does not store up speed.
    this.velocity.x = (this.position.x - this.previousPosition.x) / dtSec;
    this.velocity.z = (this.position.z - this.previousPosition.z) / dtSec;
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
    camera.position.set(
      this.previousPosition.x + (this.position.x - this.previousPosition.x) * alpha,
      playerConfig.eyeHeightM,
      this.previousPosition.z + (this.position.z - this.previousPosition.z) * alpha,
    );
    camera.rotation.set(this.pitchRad, this.yawRad, 0, 'YXZ');
  }
}
