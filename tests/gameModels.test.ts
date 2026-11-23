import { describe, expect, it } from 'vitest';
import credits from '../CREDITS.md?raw';
import { gameModelPattern, levelModelsBudgetBytes, maxTexturePx, propTriangleBudget } from '../src/level/modelFit';
import { glbFacts } from './glbFacts';

// The game's own model files (5.5b Part 2, decision 289) keep the asset rules (assets.md): every one is credited, under
// 2000 triangles, its pictures no wider than 1024 px and inside the file, and all of them together under the budget.

const files = import.meta.glob<string>('../src/assets/models/*.glb', { eager: true, query: '?inline', import: 'default' });
const bytesOf = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0));
const models = Object.entries(files).map(([path, dataUrl]) => ({ file: path.split('/').pop()!, bytes: bytesOf(dataUrl) }));

describe('the game model files', () => {
  it(`together stay under ${levelModelsBudgetBytes / 1e6} MB`, () => {
    expect(models.reduce((sum, model) => sum + model.bytes.length, 0)).toBeLessThan(levelModelsBudgetBytes);
  });

  for (const { file, bytes } of models) {
    it(`${file}: named, credited, under the triangle budget, pictures inside and small`, () => {
      expect(gameModelPattern.test(file.replace(/\.glb$/, '')), 'named prop-<name>.glb').toBe(true);
      expect(credits.includes(file), `${file} needs a line in CREDITS.md`).toBe(true);
      const facts = glbFacts(bytes);
      expect(facts.triangles).toBeLessThan(propTriangleBudget);
      expect(facts.otherImages, 'pictures must be PNG inside the file (or checked by hand and this test widened)').toEqual([]);
      for (const px of facts.texturePx) expect(px).toBeLessThanOrEqual(maxTexturePx);
    });
  }
});
