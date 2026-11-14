import type { HitZone } from './dummy';

/**
 * Anything the player's bullets, knife and grenades can hurt: the test dummies and the stand-in enemy (4.1).
 * All of them have the dummies' size and shape (`dummyConfig`), so one hit test (`rayHitDummy`) serves them all.
 */
export interface Target {
  /** Where its feet are. */
  readonly xM: number;
  readonly zM: number;
  /** False once it is dying or down: it is out of the fight. */
  readonly hittable: boolean;
  /** A head hit always kills. Returns true if this hit killed. */
  hit(zone: HitZone, bodyDamage: number): boolean;
  /** Kills at once (a knife from behind). Returns true if it killed. */
  kill(): boolean;
  /** True if a point (an attacker) is in its rear half. */
  isBehind(xM: number, zM: number): boolean;
}
