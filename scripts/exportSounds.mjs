// Writes every sound the game makes in code to exports/sounds/ as .wav files, for the Unity version (decision 292).
// Run with `npm run export-sounds`. Vite's runnerImport loads the TypeScript, so no extra tool is needed.
import { mkdir, writeFile } from 'node:fs/promises';
import { runnerImport } from 'vite';

const sampleRate = 48000;
const outDir = 'exports/sounds';

const { module: sounds } = await runnerImport('/src/audio/recipes.ts');
const { module: wav } = await runnerImport('/src/audio/wav.ts');

await mkdir(outDir, { recursive: true });
let count = 0;
for (const name of sounds.soundNames) {
  for (let variant = 0; variant < sounds.recipes[name].variants; variant++) {
    const number = String(variant + 1).padStart(2, '0');
    const bytes = wav.encodeWav(sounds.makeSound(name, variant, sampleRate), sampleRate);
    await writeFile(`${outDir}/sfx-${name}-${number}.wav`, bytes);
    count++;
  }
}
console.log(`Wrote ${count} files to ${outDir}/ (${sounds.soundNames.length} sounds).`);
