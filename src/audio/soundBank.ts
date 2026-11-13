import { makeSound, recipes, soundNames, type SoundName } from './recipes';
import { parseSoundFile } from './soundFiles';

// Real recordings dropped into src/assets/audio/ are found here and bundled with the game (so they load by relative path
// from the game's own files, never from another site). With no files the glob is simply empty.
const recordedFiles = import.meta.glob('../assets/audio/*.ogg', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

// A bank of sounds ready to play: the built-in ones made from their recipes, and any real recording found for a name.
// A real recording replaces all the built-in versions of its name.
export class SoundBank {
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();

  constructor(private readonly context: BaseAudioContext) {
    for (const name of soundNames) {
      const versions: AudioBuffer[] = [];
      for (let variant = 0; variant < recipes[name].variants; variant++) {
        const samples = makeSound(name, variant, context.sampleRate);
        const buffer = context.createBuffer(1, samples.length, context.sampleRate);
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
        versions.push(buffer);
      }
      this.buffers.set(name, versions);
    }
  }

  /** Loads the real recordings, if any, and swaps them in for the built-in sounds. Failures leave the built-in sound. */
  async loadRecordings(): Promise<void> {
    const found = new Map<SoundName, { variant: number; load: () => Promise<string> }[]>();
    for (const [path, load] of Object.entries(recordedFiles)) {
      const file = parseSoundFile(path);
      if (!file) {
        console.warn(`Audio file ignored (the name does not follow sfx-<name>[-NN].ogg): ${path}`);
        continue;
      }
      found.set(file.name, [...(found.get(file.name) ?? []), { variant: file.variant, load }]);
    }
    for (const [name, files] of found) {
      try {
        files.sort((a, b) => a.variant - b.variant);
        const decoded: AudioBuffer[] = [];
        for (const file of files) {
          const response = await fetch(await file.load());
          decoded.push(await this.context.decodeAudioData(await response.arrayBuffer()));
        }
        this.buffers.set(name, decoded);
      } catch (error) {
        console.warn(`Could not load the recording for "${name}"; keeping the built-in sound.`, error);
      }
    }
  }

  /** One version of a sound, chosen at random. */
  pick(name: SoundName): AudioBuffer | undefined {
    const versions = this.buffers.get(name);
    if (!versions || versions.length === 0) return undefined;
    return versions[Math.floor(Math.random() * versions.length)];
  }
}
