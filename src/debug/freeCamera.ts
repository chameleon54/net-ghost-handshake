import type { PerspectiveCamera } from 'three';
import { inputConfig } from '../config/input';
import type { Input } from '../core/input';

// The free camera: fly around with the player frozen. Debug only (loaded by the dev server).
// Yaw 0 looks toward -z, a positive yaw turns left, a positive pitch looks up (same as the player camera).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Velocity for the free camera. `forward` moves along where you look (up and down included), `right` sideways,
 * `up` straight up in the world. Each is -1, 0 or 1; combinations are not faster than a single key.
 */
export function flyVelocity(
  forward: number,
  right: number,
  up: number,
  yawRad: number,
  pitchRad: number,
  speedMps: number,
  out: Vec3,
): Vec3 {
  const cosPitch = Math.cos(pitchRad);
  const x = -Math.sin(yawRad) * cosPitch * forward + Math.cos(yawRad) * right;
  const y = Math.sin(pitchRad) * forward + up;
  const z = -Math.cos(yawRad) * cosPitch * forward - Math.sin(yawRad) * right;
  const length = Math.hypot(x, y, z);
  const scale = length > 1 ? speedMps / length : speedMps;
  out.x = x * scale;
  out.y = y * scale;
  out.z = z * scale;
  return out;
}

export class FreeCamera {
  active = false;
  /** Metres per second; Shift multiplies it. Tunable from the panel. */
  speedMps = 6;
  fastMultiplier = 3;

  private yawRad = 0;
  private pitchRad = 0;
  private readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly mouseMove = { x: 0, y: 0 };

  /** Start flying from where `camera` is now. */
  enter(camera: PerspectiveCamera): void {
    this.active = true;
    this.yawRad = camera.rotation.y;
    this.pitchRad = camera.rotation.x;
    this.position.x = camera.position.x;
    this.position.y = camera.position.y;
    this.position.z = camera.position.z;
  }

  exit(): void {
    this.active = false;
  }

  /** Look, fly and place `camera`. Keys and mouse only count while the game is playing (Input ignores them when paused). */
  update(dtSec: number, input: Input, camera: PerspectiveCamera): void {
    input.consumeMouseMove(this.mouseMove);
    this.yawRad -= this.mouseMove.x * inputConfig.mouseSensitivityRadPerPx;
    this.pitchRad -= this.mouseMove.y * inputConfig.mouseSensitivityRadPerPx;
    this.pitchRad = Math.max(-inputConfig.pitchLimitRad, Math.min(inputConfig.pitchLimitRad, this.pitchRad));

    const forward = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
    const right = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
    const up = (input.isKeyDown('Space') ? 1 : 0) - (input.isKeyDown('KeyC') ? 1 : 0);
    const fast = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
    flyVelocity(forward, right, up, this.yawRad, this.pitchRad, this.speedMps * (fast ? this.fastMultiplier : 1), this.velocity);

    this.position.x += this.velocity.x * dtSec;
    this.position.y += this.velocity.y * dtSec;
    this.position.z += this.velocity.z * dtSec;

    camera.position.set(this.position.x, this.position.y, this.position.z);
    camera.rotation.set(this.pitchRad, this.yawRad, 0, 'YXZ');
  }
}
