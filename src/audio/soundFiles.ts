import { soundNames, type SoundName } from './recipes';

/** A real recording found in src/assets/audio/ for a built-in sound name. */
export interface SoundFile {
  name: SoundName;
  /** Which version it is (1, 2, 3...). A name with no number counts as version 1. */
  variant: number;
}

const isSoundName = (text: string): text is SoundName => (soundNames as readonly string[]).includes(text);

/**
 * Reads a sound's name and version from a file path. File names follow assets.md: `sfx-<name>.ogg` or
 * `sfx-<name>-01.ogg`, for example `sfx-rifle-fire-01.ogg`. A name that already ends in a number (rack-tap-1) is
 * understood too. Returns null if the file does not follow the naming (it is then ignored).
 */
export function parseSoundFile(path: string): SoundFile | null {
  const fileName = path.split('/').pop() ?? '';
  if (!fileName.startsWith('sfx-') || !fileName.endsWith('.ogg')) return null;
  const stem = fileName.slice('sfx-'.length, -'.ogg'.length);
  if (isSoundName(stem)) return { name: stem, variant: 1 };
  const numbered = /^(.+)-(\d+)$/.exec(stem);
  if (numbered && isSoundName(numbered[1])) return { name: numbered[1], variant: Number.parseInt(numbered[2], 10) };
  return null;
}
