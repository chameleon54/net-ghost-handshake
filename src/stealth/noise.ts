import type { Vector3 } from 'three';

/** What made a noise. Enemy perception can treat kinds differently (a jam is not the same as a gunshot). */
export type NoiseKind =
  | 'rifle-shot'
  | 'pistol-shot'
  | 'impact'
  | 'empty-click'
  | 'reload'
  | 'jam'
  | 'jam-click'
  | 'rack'
  | 'knife-swing'
  | 'knife-stab'
  | 'grenade-bounce'
  | 'grenade-blast';

/**
 * A sound the player made that enemies could hear (architecture.md: the Noise service). It carries where it came from
 * and how far it carries. Enemy perception (4.10) and the squad coordinator listen to `noise:made` events.
 */
export interface Noise {
  kind: NoiseKind;
  position: Vector3;
  radiusM: number;
}

/**
 * True if a listener at `point` hears the noise: it is within the noise's radius.
 * shortcut: distance only, walls do not muffle it. Upgrade in 4.10 so a wall makes a noise carry less far.
 */
export function hearsNoise(noise: Noise, point: Vector3): boolean {
  return noise.position.distanceTo(point) <= noise.radiusM;
}
