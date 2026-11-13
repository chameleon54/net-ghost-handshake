import type { Vector3 } from 'three';

/** Where a shot went, for effects (and later sound and enemy hearing). The vectors are reused: read them straight away. */
export interface ShotLanded {
  /** Where the tracer starts: the gun's muzzle. */
  muzzle: Vector3;
  /** Where the bullet ended: the surface it hit, or the end of its range. */
  end: Vector3;
  /** True if it hit something; `normal` is then the surface direction. */
  hit: boolean;
  normal: Vector3;
}

export type WeaponEvents = {
  /** A round left the gun. The shooter works out where it went. */
  'weapon:fired': undefined;
  /** The trigger was pulled on an empty gun. Enemies will hear this later. */
  'weapon:empty-click': undefined;
  'weapon:reload-started': undefined;
  'weapon:reloaded': undefined;
  'shot:landed': ShotLanded;
};
