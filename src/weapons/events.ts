import type { Vector3 } from 'three';
import type { HitZone } from '../enemies/dummy';
import type { MagazineFeel } from './magazineFeel';

export type GunId = 'rifle' | 'pistol';
export type WeaponId = GunId | 'knife';

/** Where a shot went, for effects (and later sound and enemy hearing). The vectors are reused: read them straight away. */
export interface ShotLanded {
  /** Where the tracer starts: the gun's muzzle. */
  muzzle: Vector3;
  /** Where the bullet ended: the surface it hit, or the end of its range. */
  end: Vector3;
  /** True if it hit a wall, prop or the floor (a bullet mark goes there); `normal` is then the surface direction. */
  hit: boolean;
  normal: Vector3;
}

export type WeaponEvents = {
  /** A round left a gun. The shooter works out where it went. The P9 is suppressed: the noise system will know from `weapon`. */
  'weapon:fired': { weapon: GunId };
  /** The knife was swung. The strike works out what it hit. */
  'weapon:swing': undefined;
  /** The trigger was pulled on an empty gun. Enemies will hear this later. */
  'weapon:empty-click': undefined;
  'weapon:reload-started': undefined;
  'weapon:reloaded': undefined;
  /** The player looked at the magazine and judged how full it is (a rough word, never a number). */
  'weapon:magazine-checked': { feel: MagazineFeel };
  /** A different weapon was taken out. */
  'weapon:switched': { weapon: WeaponId };
  'shot:landed': ShotLanded;
  /** A weapon hit a target. Hit markers (and later sound) listen. */
  'target:hit': { zone: HitZone; killed: boolean };
};
