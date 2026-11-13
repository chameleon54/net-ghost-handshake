import type { Vector3 } from 'three';
import type { SoundName } from './recipes';

export interface PlayOptions {
  /** How loud, as a share (1 is as made). Multiplied by the sound's volume group and the master volume. */
  volume?: number;
  /** Playback speed: 1 is normal, 1.04 is a little higher and faster. */
  rate?: number;
  /** Where the sound is in the world. Without it the sound is centred, like your own gun. */
  position?: Vector3;
}

/** Anything that can play a named sound. The game's audio system does; tests use a fake one. */
export interface SoundPlayer {
  play(name: SoundName, options?: PlayOptions): void;
}
