import { dummyConfig } from '../config/dummy';
import { Health } from './health';

export type HitZone = 'head' | 'body';
export type DummyState = 'standing' | 'falling' | 'down';

// A stationary target for testing weapons (milestone 2.2). It has health, dies, lies down and stands up again.
// The real enemies come in phase 4; this is not one of them.
export class Dummy {
  health = new Health(dummyConfig.healthPoints);
  state: DummyState = 'standing';
  private stateSec = 0;

  /** `xM`, `zM`: where its feet are. `yawRad`: which way it faces; 0 faces north (-z), like the player's yaw. */
  constructor(
    readonly xM: number,
    readonly zM: number,
    readonly yawRad = 0,
  ) {}

  /** Only a standing dummy can be hit; a falling or lying one is out of the fight. */
  get hittable(): boolean {
    return this.state === 'standing';
  }

  /** 0 when standing, 1 when flat. Drives the tip-over drawing. */
  get fallProgress(): number {
    if (this.state === 'standing') return 0;
    if (this.state === 'down') return 1;
    return Math.min(this.stateSec / dummyConfig.fallTimeSec, 1);
  }

  /** A head hit always kills, whatever the damage. Returns true if this hit killed the dummy. */
  hit(zone: HitZone, bodyDamage: number): boolean {
    if (!this.hittable) return false;
    if (zone === 'head') return this.kill();
    const killed = this.health.damage(bodyDamage);
    if (killed) this.setState('falling');
    return killed;
  }

  /** Kills at once (a knife from behind). Returns true if it killed. */
  kill(): boolean {
    if (!this.hittable) return false;
    const killed = this.health.kill();
    if (killed) this.setState('falling');
    return killed;
  }

  /** True if a point (an attacker) is in the dummy's rear half: more than 90 degrees from the way it faces. */
  isBehind(xM: number, zM: number): boolean {
    const facingX = -Math.sin(this.yawRad);
    const facingZ = -Math.cos(this.yawRad);
    return facingX * (xM - this.xM) + facingZ * (zM - this.zM) < 0;
  }

  update(dtSec: number): void {
    this.stateSec += dtSec;
    if (this.state === 'falling' && this.stateSec >= dummyConfig.fallTimeSec) this.setState('down');
    else if (this.state === 'down' && this.stateSec >= dummyConfig.respawnDelaySec) {
      this.health = new Health(dummyConfig.healthPoints);
      this.setState('standing');
    }
  }

  private setState(state: DummyState): void {
    this.state = state;
    this.stateSec = 0;
  }
}
