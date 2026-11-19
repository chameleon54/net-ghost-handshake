import testArenaFile from './levels/test-arena.json';
import { checkLevel, levelLayout, spotRad } from '../level/levelData';

// The test arena (decision 236), 30 m (x) by 24 m (z), centred on 0,0: a grey-box arena built to the central chamber rules
// in level.md for testing squad tactics. It is NOT the central chamber (layout.md pass 3), which replaces it in 5.3. Since
// 5.2 (decision 273) it lives in the level data file `levels/test-arena.json`, checked on load; this module hands its parts
// out under the names the game and the tests already use. Rook starts in the south, the squad in the north.

export const testArenaLevel = checkLevel(testArenaFile);

/** The boxes: walls and props, each with an id and a label. Cover points are generated from the props. */
export const testArena = testArenaLevel.boxes;

/** The floor: its size, footstep surfaces (a tile patch by the start, a metal one in the north-east) and the test hazard pad. */
export const testArenaLayout = levelLayout(testArenaLevel);

/** Where Rook starts (and restarts): south, facing north. */
export const testArenaStart = spotRad(testArenaLevel.start);

/** Target dummies, facing the start. */
export const testArenaDummies = testArenaLevel.dummies.map(spotRad);

/**
 * The squad's spawns, facing the start: A to D are one of each role over the north and the east; E to H (4.13b, decision
 * 258) fill a squad of 8 over the north-west and the west. The dev panel's count takes the first few.
 */
export const testArenaStandIns = testArenaLevel.spawns.map(spotRad);
