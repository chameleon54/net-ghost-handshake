import { checkLevel, LevelError, levelNamePattern, levelToJson } from './levelData';

// What the dev server's save endpoint does with a request (5.2, decision 273), without the server: the name must be a
// level name, the body must pass the level checker, and its name must match. The plugin in vite.config.ts writes the
// result to src/data/levels/<name>.json. Kept here, free of Node, so it can be tested.

export const levelSaveUrl = '/__level-save';
export const levelNameHeader = 'x-level-name';
/** A level file is tens of KB; anything this big is not a level. */
export const maxLevelBytes = 2_000_000;

export type LevelSaveResult = { ok: true; fileName: string; text: string } | { ok: false; status: number; message: string };

export function levelSaveRequest(name: string | undefined, body: string): LevelSaveResult {
  if (!name || !levelNamePattern.test(name)) return { ok: false, status: 400, message: 'The level name must be lowercase letters, digits and hyphens.' };
  if (body.length > maxLevelBytes) return { ok: false, status: 413, message: 'The level is too big to be a level file.' };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, message: 'The level is not valid JSON.' };
  }
  try {
    const level = checkLevel(raw);
    if (level.name !== name) return { ok: false, status: 400, message: `The level is named "${level.name}" but was sent as "${name}".` };
    return { ok: true, fileName: `${name}.json`, text: levelToJson(level) };
  } catch (error) {
    if (error instanceof LevelError) return { ok: false, status: 400, message: error.message };
    throw error;
  }
}
