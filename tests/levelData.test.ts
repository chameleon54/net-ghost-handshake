import { describe, expect, it } from 'vitest';
import { checkLevel, coverRemoveRadiusM, LevelError, levelToJson, spotRad, type LevelData } from '../src/level/levelData';
import { levelCover } from '../src/level/cover';
import { testArenaLevel } from '../src/data/testArena';
import arenaText from '../src/data/levels/test-arena.json?raw';
import { addBox, addMarker, dragOnFloor, duplicate, EditHistory, freeId, moveBy, pickAt, picked, rayBoxM, remove, setField, snapTo, turn } from '../src/level/levelEdit';
import { levelSaveRequest } from '../src/level/levelSave';

/** A small valid level to break on purpose. */
const small = (): LevelData => ({
  formatVersion: 2,
  name: 'small',
  floor: { widthM: 10, depthM: 8, surfaces: [], hazards: [] },
  start: { id: 'start', xM: 0, zM: 3, yawDeg: 0 },
  dummies: [{ id: 'dummy-1', xM: 2, zM: 2, yawDeg: 180 }],
  spawns: [{ id: 'spawn-1', xM: 0, zM: -3, yawDeg: 180, role: 'trooper' }],
  boxes: [
    { id: 'crate', label: 'crate', kind: 'prop', xM: 0, zM: 0, widthM: 1, depthM: 1, heightM: 1 },
    { id: 'wall', label: 'north wall', kind: 'wall', xM: 0, zM: -4.15, widthM: 10.6, depthM: 0.3, heightM: 3 },
  ],
  coverAdd: [],
  coverRemove: [],
  acousticZones: [],
  speakers: [],
  arrivals: [],
});

/** The problems the checker names for `raw`, or [] if it passes. */
const problemsOf = (raw: unknown): readonly string[] => {
  try {
    checkLevel(raw);
    return [];
  } catch (error) {
    if (error instanceof LevelError) return error.problems;
    throw error;
  }
};

describe('the level data format (5.2)', () => {
  it('the test arena file passes the checker and writes back exactly as it is', () => {
    expect(testArenaLevel.boxes).toHaveLength(26);
    expect(levelToJson(checkLevel(JSON.parse(arenaText)))).toBe(arenaText);
  });

  it('names each bad field', () => {
    const bad = JSON.parse(JSON.stringify(small()));
    bad.boxes[0].heightM = 0;
    bad.boxes[1].kind = 'tree';
    bad.spawns[0].role = 'sniper';
    bad.start.yawDeg = 'north';
    delete bad.floor;
    const problems = problemsOf(bad);
    expect(problems).toContain('boxes[0].heightM must be a number above 0');
    expect(problems).toContain('boxes[1].kind must be one of wall, prop');
    expect(problems).toContain('spawns[0].role must be one of trooper, flanker, heavy, leader');
    expect(problems).toContain('start.yawDeg must be a number');
    expect(problems).toContain('floor must be an object');
  });

  it('refuses two boxes with one id, a bad name, a missing list, and another format version', () => {
    const twice = small();
    twice.boxes[1].id = 'crate';
    expect(problemsOf(twice)).toEqual(['boxes[1].id "crate" is used twice (ids must be unique)']);
    expect(problemsOf({ ...small(), name: 'My Level' })[0]).toMatch(/^name must be lowercase/);
    const noSpeakers: Partial<LevelData> = small();
    delete noSpeakers.speakers;
    expect(problemsOf(noSpeakers)).toEqual(['speakers must be a list']);
    expect(problemsOf({ ...small(), formatVersion: 4 })).toEqual(['formatVersion must be 1, 2 or 3 (this game reads all of them)']);
  });

  it('keeps optional fields out unless the file has them, and rounds editing dust off distances', () => {
    const level = small();
    level.boxes[0].xM = 0.1 + 0.2; // 0.30000000000000004
    const text = levelToJson(level);
    expect(text).toContain('"xM":0.3,');
    expect(text).not.toContain('climbable');
    expect(checkLevel(JSON.parse(text)).boxes[0]).not.toHaveProperty('yM');
  });

  it('reads ramps and drawn-only or solid-only boxes, and refuses a box that is neither', () => {
    const level = small();
    level.boxes[0] = { ...level.boxes[0], ramp: 'north', drawn: false };
    level.boxes[1] = { ...level.boxes[1], solid: false };
    const checked = checkLevel(JSON.parse(levelToJson(level)));
    expect(checked.boxes[0]).toMatchObject({ ramp: 'north', drawn: false });
    expect(checked.boxes[1].solid).toBe(false);
    expect(problemsOf({ ...small(), boxes: [{ ...small().boxes[0], ramp: 'up' }] })).toEqual(['boxes[0].ramp must be one of north, south, east, west']);
    expect(problemsOf({ ...small(), boxes: [{ ...small().boxes[0], drawn: false, solid: false }] })).toEqual(['boxes[0] is neither drawn nor solid, so it does nothing']);
  });

  it('a ramp or a box that is only drawn is never cover', () => {
    const level = small();
    level.boxes[0] = { ...level.boxes[0], solid: false };
    expect(levelCover(level)).toEqual([]);
    level.boxes[0] = { ...level.boxes[0], solid: undefined, ramp: 'east' };
    delete level.boxes[0].solid;
    expect(levelCover(level)).toEqual([]);
  });

  it('cover: generated from the props (never glass), less hand removals, plus hand additions', () => {
    const level = small();
    const generated = levelCover(level);
    expect(generated.length).toBeGreaterThan(0); // the crate (walls make none)
    const first = generated[0];
    level.coverRemove = [{ xM: first.xM + coverRemoveRadiusM / 2, zM: first.zM }];
    level.coverAdd = [{ xM: 4, zM: 0, height: 'high', facingYawRad: 0 }];
    const fixed = levelCover(level);
    expect(fixed).not.toContainEqual(first);
    expect(fixed).toContainEqual(level.coverAdd[0]);
    level.boxes[0].glass = true;
    expect(levelCover(level)).toEqual([level.coverAdd[0]]);
  });

  it('a spot faces in degrees in the file and in radians in the game', () => {
    expect(spotRad({ id: 'a', xM: 1, zM: 2, yawDeg: 180 })).toEqual({ id: 'a', xM: 1, zM: 2, yawRad: Math.PI });
  });
});

describe('editing a level (5.2)', () => {
  const down = { x: 0, y: -1, z: 0 };

  it('a ray picks the nearest box or marker it hits', () => {
    expect(rayBoxM({ x: 0, y: 5, z: 0 }, down, { x: -1, y: 0, z: -1 }, { x: 1, y: 1, z: 1 })).toBeCloseTo(4);
    expect(rayBoxM({ x: 3, y: 5, z: 0 }, down, { x: -1, y: 0, z: -1 }, { x: 1, y: 1, z: 1 })).toBe(Infinity);
    const level = small();
    expect(pickAt(level, { x: 0, y: 5, z: 0 }, down)).toBe('crate');
    expect(pickAt(level, { x: 2, y: 5, z: 2 }, down)).toBe('dummy-1');
    expect(pickAt(level, { x: 0, y: 1, z: 6 }, { x: 0, y: 0, z: -1 })).toBe('start'); // the start is nearer than the crate
    expect(pickAt(level, { x: 4, y: 5, z: 3.5 }, down)).toBe(null);
  });

  it('moves, raises (never below the floor) and turns a box; markers stay on the floor and turn left', () => {
    let level = small();
    const crate = 'crate';
    level = moveBy(level, crate, 0.25, 0.5, -1);
    expect(level.boxes[0]).toMatchObject({ xM: 0.25, zM: -1, yM: 0.5 });
    level = moveBy(level, crate, 0, -2, 0);
    expect(level.boxes[0]).not.toHaveProperty('yM');
    level.boxes[0] = { ...level.boxes[0], widthM: 3, depthM: 0.8 };
    expect(turn(level, crate).boxes[0]).toMatchObject({ widthM: 0.8, depthM: 3 });
    const start = 'start';
    expect(moveBy(level, start, 1, 5, 0).start).toEqual({ id: 'start', xM: 1, zM: 3, yawDeg: 0 });
    expect(turn(level, start).start.yawDeg).toBe(90);
    expect(turn(turn(turn(turn(level, start), start), start), start).start.yawDeg).toBe(0);
  });

  it('leaves the old level as it was (what undo keeps)', () => {
    const before = small();
    const text = JSON.stringify(before);
    moveBy(before, 'crate', 1, 1, 1);
    turn(before, 'spawn-1');
    setField(before, 'crate', 'label', 'x');
    expect(JSON.stringify(before)).toBe(text);
  });

  it('duplicates with a new id 1 m east, removes, and refuses to copy or delete the start', () => {
    const level = small();
    const copy = duplicate(level, 'crate')!;
    expect(copy.level.boxes[2]).toMatchObject({ id: 'crate-2', label: 'crate', xM: 1 });
    expect(copy.pick).toBe('crate-2');
    expect(checkLevel(copy.level).boxes).toHaveLength(3); // still a valid level
    expect(remove(level, 'dummy-1')!.dummies).toEqual([]);
    expect(duplicate(level, 'start')).toBe(null);
    expect(remove(level, 'start')).toBe(null);
    expect(duplicate(level, 'dummy-1')!.level.dummies[1].id).toBe('dummy-2'); // markers get new ids too
    expect(freeId(copy.level, 'crate')).toBe('crate-3');
  });

  it('adds pieces from the presets and markers, each a valid part of the level', () => {
    let level = small();
    for (const preset of ['low cover', 'climbable', 'high cover', 'wall', 'glass'] as const) level = addBox(level, preset, 1, 1).level;
    level = addMarker(level, 'spawns', 2, 2).level;
    level = addMarker(level, 'dummies', 3, 3).level;
    const checked = checkLevel(JSON.parse(levelToJson(level)));
    expect(checked.boxes.map((b) => b.id)).toEqual(['crate', 'wall', 'low-cover', 'climbable', 'high-cover', 'wall-2', 'glass']);
    expect(checked.boxes[6].glass).toBe(true);
    expect(checked.spawns[1]).toEqual({ id: 'spawn-2', xM: 2, zM: 2, yawDeg: 180, role: 'trooper' });
  });

  it('undo gives the levels back newest first, at most the limit', () => {
    const history = new EditHistory(2);
    const a = small();
    const b = moveBy(a, 'crate', 1, 0, 0);
    const c = moveBy(b, 'crate', 1, 0, 0);
    history.push(a);
    history.push(b);
    history.push(c);
    expect(history.undo()).toBe(c);
    expect(history.undo()).toBe(b);
    expect(history.undo()).toBe(null); // a fell off the end
  });
});

describe('ids and dragging (5.2b, decision 281)', () => {
  it('a version 1 file loads and its start, dummies and spawns get ids that clash with nothing', () => {
    const old = JSON.parse(JSON.stringify(small())) as Record<string, unknown> & LevelData;
    old.formatVersion = 1;
    for (const spot of [old.start, ...old.dummies, ...old.spawns]) delete (spot as Partial<typeof spot>).id;
    old.boxes[0].id = 'spawn-1'; // a box already holds the name a spawn would get
    const checked = checkLevel(old);
    expect(checked.formatVersion).toBe(3);
    expect([checked.start.id, checked.dummies[0].id, checked.spawns[0].id]).toEqual(['start', 'dummy-1', 'spawn-2']);
    expect(levelToJson(checked)).toContain('"formatVersion": 3');
  });

  it('two items with one id are a problem, boxes and markers alike', () => {
    const level = small();
    level.dummies[0].id = 'crate';
    expect(problemsOf(level).join()).toContain('"crate" is used twice');
  });

  it('a selection follows its item by id after a delete or an undo', () => {
    const level = small();
    const fewer = remove(level, 'crate')!;
    expect(picked(fewer, 'wall')).toMatchObject({ label: 'north wall' }); // it was second, now first: still the wall
    expect(picked(fewer, 'crate')).toBeUndefined();
    expect(moveBy(fewer, 'crate', 1, 0, 0)).toBe(fewer); // nothing to move: the level is unchanged
  });

  it('a right-button drag moves on the floor: sideways along the camera right, pushed away along its view', () => {
    expect(dragOnFloor(0, 100, 0, 0.01)).toEqual({ dx: 1, dz: 0 }); // looking north, mouse right: east
    const away = dragOnFloor(0, 0, -100, 0.01); // mouse pushed away: north, where it looks
    expect(away.dx).toBeCloseTo(0);
    expect(away.dz).toBeCloseTo(-1);
    const west = dragOnFloor(Math.PI / 2, 100, 0, 0.01); // looking west, mouse right: north
    expect(west.dx).toBeCloseTo(0);
    expect(west.dz).toBeCloseTo(-1);
  });

  it('dragging rounds to 0.05 m, and to the 0.25 m grid with Shift', () => {
    expect(snapTo(1.237, 0.05)).toBe(1.25);
    expect(snapTo(1.212, 0.05)).toBe(1.2);
    expect(snapTo(1.37, 0.25)).toBe(1.25);
    expect(snapTo(-0.13, 0.25)).toBe(-0.25);
  });
});

describe("the dev server's level save (5.2)", () => {
  it('writes only a checked level under a good name that matches it', () => {
    const ok = levelSaveRequest('small', levelToJson(small()));
    expect(ok).toEqual({ ok: true, fileName: 'small.json', text: levelToJson(small()) });
    expect(levelSaveRequest('../src/main', levelToJson(small()))).toMatchObject({ ok: false, status: 400 });
    expect(levelSaveRequest(undefined, levelToJson(small()))).toMatchObject({ ok: false, status: 400 });
    expect(levelSaveRequest('other', levelToJson(small()))).toMatchObject({ ok: false, status: 400 });
    expect(levelSaveRequest('small', '{ not json')).toMatchObject({ ok: false, status: 400 });
    const bad = levelSaveRequest('small', JSON.stringify({ ...small(), boxes: 'none' }));
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(!bad.ok && bad.message).toContain('boxes must be a list');
  });
});
