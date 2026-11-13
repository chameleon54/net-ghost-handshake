import type { Vector3 } from 'three';
import type { HitZone } from '../enemies/dummy';
import type { MagazineCheck } from './magazineFeel';

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
  'weapon:fired': { weapon: GunId; /** The gun's heat after this shot, 0 to 100. A hot gun rattles. */ heat: number };
  /** The knife was swung. The strike works out what it hit. */
  'weapon:swing': undefined;
  /** The trigger was pulled on an empty gun. Enemies will hear this later. */
  'weapon:empty-click': undefined;
  /** A reload began. `durationSec` is all of it; `rackShare` is the share at the end that is the rack of an empty gun. */
  'weapon:reload-started': { weapon: GunId; durationSec: number; rackShare: number };
  /** The player started checking the magazine; it takes `durationSec`. */
  'weapon:check-started': { weapon: GunId; durationSec: number };
  /** The player started inspecting the weapon; it takes `durationSec`. */
  'weapon:inspect-started': { weapon: WeaponId; durationSec: number };
  /** A reload or a magazine check was stopped before it finished (switching weapon, sprinting). */
  'weapon:interrupted': { weapon: GunId };
  'weapon:reloaded': undefined;
  /** The gun jammed instead of firing: the chambered round is stuck. Enemies will hear this later. */
  'weapon:jammed': { weapon: GunId };
  /** The trigger was pulled on a jammed gun: a dead click. */
  'weapon:jam-click': { weapon: GunId };
  /** One fast rack while clearing a jam: `tap` of `taps` done. */
  'weapon:rack': { weapon: GunId; tap: number; taps: number };
  /** The last tap: the stuck round is thrown out and the gun is ready. */
  'weapon:jam-cleared': { weapon: GunId };
  /** The player looked at the magazine in the gun and the spares and judged how full each is (rough words, never numbers). */
  'weapon:magazine-checked': { check: MagazineCheck };
  /** A different weapon was taken out. */
  'weapon:switched': { weapon: WeaponId };
  'shot:landed': ShotLanded;
  /** A weapon hit a target. Hit markers (and later sound) listen. */
  'target:hit': { zone: HitZone; killed: boolean; weapon: WeaponId };
  /** A spent casing bounced off a surface, at `speedMps` into it. For the clink. The position vector is reused. */
  'casing:bounced': { position: Vector3; speedMps: number };
};
