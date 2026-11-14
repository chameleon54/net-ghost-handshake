import type { SoundName } from './recipes';
import type { PlayOptions, SoundPlayer } from './soundPlayer';

/** What the tap tells a listener about each sound: its name, how it was asked for, and whether it can actually be heard. */
export type SoundTapListener = (name: SoundName, options: PlayOptions, audible: boolean) => void;

// A pass-through in front of the real sound player. Every sound goes on to the real player as usual; if a listener is set
// (the dev panel's captions) it is told about each one first. In the release build no listener is ever set.
export class SoundTap implements SoundPlayer {
  /** Set by the dev tools to see every sound; null otherwise. */
  onPlay: SoundTapListener | null = null;

  constructor(
    private readonly inner: SoundPlayer,
    /** True when sound can really be heard right now (the audio has started). */
    private readonly isAudible: () => boolean,
  ) {}

  play(name: SoundName, options: PlayOptions = {}): void {
    this.onPlay?.(name, options, this.isAudible());
    this.inner.play(name, options);
  }

  duck(share: number, seconds: number): void {
    this.inner.duck?.(share, seconds);
  }
}
