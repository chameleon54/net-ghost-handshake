import * as THREE from 'three';
import { audioConfig } from '../config/audio';
import { resumeAudio, suspendAudio } from '../platform/audio';
import { recipes, type SoundGroup, type SoundName } from './recipes';
import { SoundBank } from './soundBank';
import type { PlayOptions, SoundPlayer } from './soundPlayer';

const plainVoices = 20; // sounds that can play at once without a position (your own gun and handling)
const spatialVoices = 10; // sounds that can play at once in the world (impacts, casings)
const spatialRefDistanceM = 4; // inside this distance a positional sound is at full volume; beyond it, it fades

const groupVolume = (group: SoundGroup): number =>
  group === 'weapon' ? audioConfig.weaponVolume : group === 'handling' ? audioConfig.handlingVolume : audioConfig.impactVolume;

// The game's sound: three.js's built-in audio on a listener that rides on the camera, with a fixed number of voices
// (so nothing is created while shooting). Sounds in the world are positional, so they come from where they happen.
// Nothing starts until `unlock` is called from the Play click (the browser rule; see platform/audio.ts).
export class AudioSystem implements SoundPlayer {
  private listener: THREE.AudioListener | null = null;
  private bank: SoundBank | null = null;
  private plain: THREE.Audio[] = [];
  private spatial: THREE.PositionalAudio[] = [];
  private nextPlain = 0;
  private nextSpatial = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Call from inside the Play click: starts the sound system the first time, and resumes it after a pause. */
  unlock(): void {
    if (!this.listener) this.create();
    resumeAudio(this.listener!.context as AudioContext);
  }

  /** Freezes the sound while the game is paused. */
  suspend(): void {
    if (this.listener) suspendAudio(this.listener.context as AudioContext);
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    const listener = this.listener;
    const buffer = this.bank?.pick(name);
    if (!listener || !buffer || listener.context.state !== 'running') return;

    listener.setMasterVolume(audioConfig.masterVolume);
    const volume = (options.volume ?? 1) * groupVolume(recipes[name].group);
    const voice = options.position ? this.nextSpatialVoice() : this.nextPlainVoice();
    if (voice.isPlaying) voice.stop(); // all voices busy: the oldest is cut off
    voice.setBuffer(buffer);
    voice.setVolume(volume);
    voice.setPlaybackRate(options.rate ?? 1);
    if (options.position && voice instanceof THREE.PositionalAudio) {
      voice.position.copy(options.position);
      voice.updateMatrixWorld(true);
    }
    voice.play();
  }

  /** Dev panel: play a sound on its own, even while the game is paused (this runs from a button click). */
  preview(name: SoundName): void {
    if (!this.listener) this.create();
    resumeAudio(this.listener!.context as AudioContext);
    this.play(name);
  }

  private create(): void {
    const listener = new THREE.AudioListener();
    this.camera.add(listener); // the listener rides on the camera: sounds are placed around the player's head
    this.listener = listener;
    this.bank = new SoundBank(listener.context);
    for (let i = 0; i < plainVoices; i++) this.plain.push(new THREE.Audio(listener));
    for (let i = 0; i < spatialVoices; i++) {
      const voice = new THREE.PositionalAudio(listener);
      voice.setRefDistance(spatialRefDistanceM);
      this.scene.add(voice);
      this.spatial.push(voice);
    }
    void this.bank.loadRecordings(); // real files, if any, replace the built-in sounds when they have loaded
  }

  private nextPlainVoice(): THREE.Audio {
    const free = this.plain.find((voice) => !voice.isPlaying);
    if (free) return free;
    this.nextPlain = (this.nextPlain + 1) % this.plain.length;
    return this.plain[this.nextPlain];
  }

  private nextSpatialVoice(): THREE.PositionalAudio {
    const free = this.spatial.find((voice) => !voice.isPlaying);
    if (free) return free;
    this.nextSpatial = (this.nextSpatial + 1) % this.spatial.length;
    return this.spatial[this.nextSpatial];
  }
}
