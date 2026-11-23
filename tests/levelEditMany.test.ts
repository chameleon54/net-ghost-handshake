import { describe, expect, it } from 'vitest';
import { checkLevel, LevelError, levelToJson, type LevelData } from '../src/level/levelData';
import { duplicateMany, listGroups, markersGroupName, moveMany, noGroupName, removeMany, setFieldMany, turnMany, picked } from '../src/level/levelEdit';
import { GizmoView } from '../src/debug/gizmoView';
import { applyHandleDrag, closestOnAxis, layoutGizmo, minBoxSizeM, pickHandle, resizeFace, selectionBounds } from '../src/level/gizmo';

// The editor's many-piece edits, the folder list, groups in the file, and the arrows and handles (5.2c, decision 285).

const level = (): LevelData => ({
  formatVersion: 3,
  name: 'small',
  floor: { widthM: 20, depthM: 20, surfaces: [], hazards: [] },
  start: { id: 'start', xM: 0, zM: 8, yawDeg: 0 },
  dummies: [{ id: 'dummy-1', xM: 2, zM: 6, yawDeg: 180 }],
  spawns: [{ id: 'spawn-1', xM: 0, zM: -8, yawDeg: 180, role: 'trooper' }],
  boxes: [
    { id: 'crate', label: 'crate', kind: 'prop', xM: 0, zM: 0, widthM: 1, depthM: 1, heightM: 1 },
    { id: 'bench', label: 'prep bench', kind: 'prop', xM: 3, zM: 0, widthM: 2, depthM: 1, heightM: 1, group: 'ring' },
    { id: 'pillar', label: 'ring pillar', kind: 'prop', xM: 5, zM: 5, widthM: 1, depthM: 1, heightM: 2, yM: 1, group: 'ring' },
    { id: 'panel', label: 'core panel', kind: 'wall', xM: -4, zM: -4, widthM: 3, depthM: 0.3, heightM: 3, group: 'core' },
  ],
  coverAdd: [],
  coverRemove: [],
  acousticZones: [],
  speakers: [],
  arrivals: [],
});

const box = (l: LevelData, id: string) => picked(l, id) as LevelData['boxes'][number];

describe('editing several pieces at once', () => {
  it('moves boxes and markers together, and skips an id that is gone', () => {
    const next = moveMany(level(), ['crate', 'dummy-1', 'ghost'], 1, 0.5, -2);
    expect([box(next, 'crate').xM, box(next, 'crate').zM, box(next, 'crate').yM]).toEqual([1, -2, 0.5]);
    expect([picked(next, 'dummy-1')!.xM, picked(next, 'dummy-1')!.zM]).toEqual([3, 4]);
    expect(box(next, 'bench').xM).toBe(3); // not selected: untouched
    expect(level().boxes[0].xM).toBe(0); // the old level is left as it was (undo keeps it)
  });

  it('a box never goes below the floor when moved down', () => {
    expect(box(moveMany(level(), ['pillar'], 0, -5, 0), 'pillar').yM).toBeUndefined();
  });

  it('turns every selected piece around its own centre', () => {
    const next = turnMany(level(), ['bench', 'pillar']);
    expect([box(next, 'bench').widthM, box(next, 'bench').depthM, box(next, 'bench').xM]).toEqual([1, 2, 3]);
    expect(box(next, 'crate').widthM).toBe(1);
  });

  it('sets or clears a field on every selected piece', () => {
    const grouped = setFieldMany(level(), ['crate', 'bench'], 'group', 'lab');
    expect([box(grouped, 'crate').group, box(grouped, 'bench').group, box(grouped, 'pillar').group]).toEqual(['lab', 'lab', 'ring']);
    expect(box(setFieldMany(grouped, ['bench'], 'group', undefined), 'bench').group).toBeUndefined();
  });

  it("removes the selected pieces but never Rook's start, and says so when nothing could go", () => {
    const next = removeMany(level(), ['crate', 'start', 'dummy-1'])!;
    expect(next.boxes.map((b) => b.id)).toEqual(['bench', 'pillar', 'panel']);
    expect(next.dummies).toEqual([]);
    expect(next.start.id).toBe('start');
    expect(removeMany(level(), ['start'])).toBeNull();
  });

  it('copies each selected piece with a new id and picks the copies', () => {
    const copied = duplicateMany(level(), ['bench', 'start', 'crate'])!;
    expect(copied.picks).toEqual(['bench-2', 'crate-2']);
    expect(box(copied.level, 'bench-2').group).toBe('ring');
    expect(box(copied.level, 'bench-2').xM).toBe(4);
    expect(duplicateMany(level(), ['start'])).toBeNull();
  });
});

describe('the editor list and groups', () => {
  it('folders the named groups alphabetically, then the loose boxes, then the markers', () => {
    const groups = listGroups(level(), '');
    expect(groups.map((g) => g.name)).toEqual(['core', 'ring', noGroupName, markersGroupName]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(['bench', 'pillar']);
    expect(groups[3].entries.map((e) => e.id)).toEqual(['start', 'dummy-1', 'spawn-1']);
  });

  it('a search matches the label, the id or the group in any case, and leaves out empty folders', () => {
    expect(listGroups(level(), 'BENCH').map((g) => g.entries.map((e) => e.id))).toEqual([['bench']]);
    expect(listGroups(level(), 'ring').map((g) => g.name)).toEqual(['ring']); // the group name and the pillar's label
    expect(listGroups(level(), 'ring')[0].entries.map((e) => e.id)).toEqual(['bench', 'pillar']);
    expect(listGroups(level(), 'crate').map((g) => g.name)).toEqual([noGroupName]);
    expect(listGroups(level(), 'zzz')).toEqual([]);
  });

  it('a group is written to the file and read back; no group leaves the key out; an empty one is refused', () => {
    const text = levelToJson(level());
    expect(text).toContain('"group":"ring"');
    expect(text.split('\n').find((line) => line.includes('"id":"crate"'))).not.toContain('group');
    expect(checkLevel(JSON.parse(text)).boxes[1].group).toBe('ring');
    const bad = JSON.parse(JSON.stringify(level())) as LevelData;
    bad.boxes[0].group = '';
    expect(() => checkLevel(bad)).toThrow(LevelError);
  });

  it('a version 2 file (no groups) still loads, and is written as the current version', () => {
    const old = { ...level(), formatVersion: 2 };
    for (const b of old.boxes) delete b.group;
    expect(checkLevel(JSON.parse(JSON.stringify(old))).formatVersion).toBe(4);
  });
});

describe('dragging an arrow along its axis', () => {
  const xAxis = { x: 1, y: 0, z: 0 };
  const zero = { x: 0, y: 0, z: 0 };

  it('finds the point of the axis under the cursor', () => {
    expect(closestOnAxis({ x: 3, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, zero, xAxis)).toBeCloseTo(3, 9); // straight down onto x = 3
    const eye = { x: 1, y: 4, z: 6 };
    const target = { x: 4, y: 0, z: 0 };
    const length = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
    const dir = { x: (target.x - eye.x) / length, y: (target.y - eye.y) / length, z: (target.z - eye.z) / length };
    expect(closestOnAxis(eye, dir, zero, xAxis)).toBeCloseTo(4, 9); // a slanted ray through a point of the axis
    expect(closestOnAxis(eye, dir, { x: 2, y: 0, z: 0 }, xAxis)).toBeCloseTo(2, 9); // measured from the axis's own origin
  });

  it('gives nothing when the ray runs along the axis or its nearest point is behind the eye', () => {
    expect(closestOnAxis({ x: -5, y: 0, z: 1 }, xAxis, zero, xAxis)).toBeNull();
    expect(closestOnAxis({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, zero, xAxis)).toBeNull();
  });
});

describe('pulling a face of a box', () => {
  it('moves one face and leaves the opposite one where it was', () => {
    const east = box(resizeFace(level(), 'crate', 'east', 1), 'crate');
    expect([east.widthM, east.xM]).toEqual([2, 0.5]); // west edge still at -0.5
    const west = box(resizeFace(level(), 'crate', 'west', 1), 'crate');
    expect([west.widthM, west.xM]).toEqual([2, -0.5]);
    const south = box(resizeFace(level(), 'crate', 'south', 2), 'crate');
    expect([south.depthM, south.zM]).toEqual([3, 1]);
    const north = box(resizeFace(level(), 'crate', 'north', 2), 'crate');
    expect([north.depthM, north.zM]).toEqual([3, -1]);
    const top = box(resizeFace(level(), 'crate', 'top', 0.5), 'crate');
    expect([top.heightM, top.yM]).toEqual([1.5, undefined]);
  });

  it('pulling the bottom of a raised box lowers it, and stops at the floor', () => {
    const lower = box(resizeFace(level(), 'pillar', 'bottom', 0.5), 'pillar');
    expect([lower.yM, lower.heightM]).toEqual([0.5, 2.5]);
    const floor = box(resizeFace(level(), 'pillar', 'bottom', 5), 'pillar');
    expect([floor.yM, floor.heightM]).toEqual([undefined, 3]); // 1 m was all there was below it
  });

  it('never makes a box smaller than the minimum, and pulling inward works', () => {
    expect(box(resizeFace(level(), 'crate', 'east', -9), 'crate').widthM).toBeCloseTo(minBoxSizeM, 9);
    expect(box(resizeFace(level(), 'bench', 'top', -0.4), 'bench').heightM).toBeCloseTo(0.6, 9);
  });

  it('does nothing to a marker or an id that is gone', () => {
    expect(resizeFace(level(), 'dummy-1', 'east', 1)).toEqual(level());
    expect(resizeFace(level(), 'ghost', 'east', 1)).toEqual(level());
  });
});

describe('the arrows and handles', () => {
  const camera = { x: 0, y: 1.5, z: 10 };

  it('the move arrows: x and z for markers, and y too when a box is selected, with the rotate ring (5.5a)', () => {
    expect(layoutGizmo(level(), ['dummy-1'], 'move', camera).map((h) => h.key)).toEqual(['move-x', 'move-z', 'turn']);
    expect(layoutGizmo(level(), ['crate', 'bench', 'pillar'], 'move', camera).map((h) => h.key)).toEqual(['move-x', 'move-y', 'move-z', 'turn']);
    expect(layoutGizmo(level(), [], 'move', camera)).toEqual([]);
  });

  it('the six size handles appear for one box only', () => {
    const handles = layoutGizmo(level(), ['bench'], 'size', camera);
    expect(handles.map((h) => h.key)).toEqual(['size-east', 'size-west', 'size-south', 'size-north', 'size-top', 'size-bottom']);
    expect(handles[0].origin).toEqual({ x: 4, y: 0.5, z: 0 }); // the bench's east face (x 3 + 1), mid height
    expect(layoutGizmo(level(), ['bench', 'crate'], 'size', camera)).toEqual([]);
    expect(layoutGizmo(level(), ['dummy-1'], 'size', camera)).toEqual([]);
  });

  it('they keep their size on screen: twice as far is twice as long', () => {
    const near = layoutGizmo(level(), ['crate'], 'move', { x: 0, y: 0.5, z: 10 })[0].scale;
    const far = layoutGizmo(level(), ['crate'], 'move', { x: 0, y: 0.5, z: 20 })[0].scale;
    expect(far / near).toBeCloseTo(2, 1);
  });

  it('aiming at a handle picks it, aiming elsewhere does not, and the nearest one wins', () => {
    const handles = layoutGizmo(level(), ['crate'], 'size', camera);
    const south = handles.find((h) => h.key === 'size-south')!;
    const aim = (to: { x: number; y: number; z: number }) => {
      const length = Math.hypot(to.x - camera.x, to.y - camera.y, to.z - camera.z);
      return { x: (to.x - camera.x) / length, y: (to.y - camera.y) / length, z: (to.z - camera.z) / length };
    };
    expect(pickHandle(handles, camera, aim(south.at))?.key).toBe('size-south');
    expect(pickHandle(handles, camera, { x: 0, y: 1, z: 0 })).toBeNull(); // straight up
    expect(pickHandle(handles, camera, aim({ x: 5, y: 0.5, z: 0 }))).toBeNull(); // beside the crate
  });

  it('dragging an arrow moves the whole selection; dragging a handle pulls its face outward', () => {
    const moveX = layoutGizmo(level(), ['crate', 'bench'], 'move', camera)[0];
    const moved = applyHandleDrag(level(), ['crate', 'bench'], moveX, 2);
    expect([box(moved, 'crate').xM, box(moved, 'bench').xM]).toEqual([2, 5]);
    const west = layoutGizmo(level(), ['crate'], 'size', camera).find((h) => h.key === 'size-west')!;
    const pulled = box(applyHandleDrag(level(), ['crate'], west, -1), 'crate'); // dragged 1 m the -x way: outward for the west face
    expect([pulled.widthM, pulled.xM]).toEqual([2, -0.5]);
  });

  it('the drawing shows the handles it is given, lights the aimed one, and hides the rest', () => {
    const view = new GizmoView();
    const move = layoutGizmo(level(), ['crate'], 'move', camera);
    view.update(move, 'move-x', null);
    expect(view.group.visible).toBe(true);
    expect(view.group.children.filter((child) => child.visible)).toHaveLength(4); // three arrows and the ring
    const size = layoutGizmo(level(), ['crate'], 'size', camera);
    view.update(size, null, 'size-east');
    expect(view.group.children.filter((child) => child.visible)).toHaveLength(6); // the arrows are hidden, not rebuilt
    view.update([], null, null);
    expect(view.group.visible).toBe(false);
  });

  it('the box around a selection covers every piece, markers as upright posts', () => {
    const bounds = selectionBounds(level(), ['crate', 'pillar', 'dummy-1'])!;
    expect(bounds.min).toEqual({ x: -0.5, y: 0, z: -0.5 });
    expect(bounds.max.x).toBe(5.5);
    expect(bounds.max.y).toBe(3);
    expect(selectionBounds(level(), ['ghost'])).toBeNull();
  });
});
