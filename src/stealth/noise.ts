import type { Vector3 } from 'three';
import { noiseConfig } from '../config/noise';

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
  | 'grenade-blast'
  | 'glass-break'
  | 'footstep'
  | 'slide'
  | 'vault'
  | 'climb'
  | 'landing';

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
 * True if a listener at `point` hears the noise: it is within the noise's radius, or, if something solid is in the way,
 * within the muffled share of it (4.10). `blocked` is asked only when it matters (it casts a ray).
 */
export function hearsNoise(noise: Noise, point: Vector3, blocked: () => boolean = () => false): boolean {
  const distanceM = noise.position.distanceTo(point);
  if (distanceM > noise.radiusM) return false;
  if (distanceM <= noise.radiusM * noiseConfig.wallMuffleShare) return true;
  return !blocked();
}
