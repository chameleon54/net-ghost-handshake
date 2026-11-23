import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { RoomBox, RoomLayout } from '../src/data/greyboxRoom';
import { distanceToBoxM, overFootprint, rayTurnedBoxM, toLocal, toWorld, worldBounds } from '../src/level/boxShape';
import { coverPointsFromBoxes } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { surfaceAt } from '../src/level/surfaces';
import { checkLevel, levelToJson, type LevelData } from '../src/level/levelData';
import { picked, pickAt, turn, turnByMany } from '../src/level/levelEdit';
import { applyHandleDrag, layoutGizmo, pickHandle, resizeFace, ringAngle } from '../src/level/gizmo';

// Free rotation of boxes (5.5a, decision 286): a turned box is where it is drawn for every system.

const deg = (d: number) => (d * Math.PI) / 180;
/** A point turned `yawDeg` about the origin, as a box's own axes turn (positive turns left seen from above). */
const turned = (x: number, z: number, yawDeg: number) => toWorld({ xM: 0, zM: 0, widthM: 1, depthM: 1, heightM: 1, yawDeg }, x, z);

describe('the shape of a turned box', () => {
  const box = { xM: 2, zM: -1, widthM: 4, depthM: 1, heightM: 2, yawDeg: 30 };

  it('its own axes turn left, as a yaw does: its own north (-z) is the facing of the same yaw', () => {
    const north = toWorld({ ...box, xM: 0, zM: 0 }, 0, -1);
    expect(north.x).toBeCloseTo(-Math.sin(deg(30)), 9); // a yaw's forward is (-sin, -cos)
    expect(north.z).toBeCloseTo(-Math.cos(deg(30)), 9);
    const back = toLocal(box, toWorld(box, 1.5, -0.3).x, toWorld(box, 1.5, -0.3).z);
    expect([back.x, back.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1.5, -0.3]);
  });

  it('a point near the end of its long side is over it; a corner of its square outline is not', () => {
    const end = toWorld(box, 1.9, 0);
    expect(overFootprint(box, end.x, end.z)).toBe(true);
    const outline = worldBounds(box);
    expect(overFootprint(box, outline.max.x - 0.01, outline.max.z - 0.01)).toBe(false);
    expect(distanceToBoxM(box, end.x, 1, end.z)).toBe(0);
  });

  it('a quarter turn swaps the square outline, as swapping width and depth did', () => {
    const quarter = worldBounds({ ...box, yawDeg: 90 });
    expect(quarter.max.x - quarter.min.x).toBeCloseTo(1, 9);
    expect(quarter.max.z - quarter.min.z).toBeCloseTo(4, 9);
  });

  it('a ray finds the turned box where it is drawn, and misses beside it inside the square outline', () => {
    const face = toWorld(box, 0, 0.5); // the middle of its own south face
    const from = toWorld(box, 0, 5);
    const dir = new Vector3(face.x - from.x, 0, face.z - from.z).normalize();
    expect(rayTurnedBoxM(new Vector3(from.x, 1, from.z), dir, box)).toBeCloseTo(4.5, 6);
    const outline = worldBounds(box);
    expect(rayTurnedBoxM(new Vector3(outline.max.x - 0.05, 5, outline.max.z - 0.05), new Vector3(0, -1, 0), box)).toBe(Infinity);
  });
});

describe('collision, cover and footsteps follow the turn', () => {
  const wall: RoomBox = { kind: 'prop', xM: 0, zM: 0, widthM: 4, depthM: 0.4, heightM: 1.2, yawDeg: 30 };
  const layout: RoomLayout = { size: { widthM: 20, depthM: 20 }, floors: [], hazards: [] };

  it('Rook bumps into it where it is drawn, not at its old square place', () => {
    const { collision } = buildGreybox([wall], layout);
    const end = toWorld(wall, 1.8, 0);
    expect(collision.overlapsCapsule(new Vector3(end.x, 0, end.z), 0.3, 1.8, 0.01)).toBe(true);
    const unturnedEnd = new Vector3(1.8, 0, 0.6); // inside where the box would be unturned, 0.6 m off the turned one's middle line: clear
    expect(overFootprint(wall, unturnedEnd.x, unturnedEnd.z, 0.3)).toBe(false);
    expect(collision.overlapsCapsule(unturnedEnd, 0.3, 1.8, 0.01)).toBe(false);
  });

  it('a quarter turn gives the same cover as swapping width and depth', () => {
    const swapped = coverPointsFromBoxes([{ ...wall, yawDeg: undefined, widthM: wall.depthM, depthM: wall.widthM }]);
    const quarter = coverPointsFromBoxes([{ ...wall, yawDeg: 90 }]);
    const mm = (v: number) => (Math.round(v * 1000) / 1000 + 0).toFixed(3); // + 0 turns -0 into 0
    const key = (p: { xM: number; zM: number; facingYawRad: number; lean?: string }) =>
      `${mm(p.xM)},${mm(p.zM)},${mm(((p.facingYawRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))},${p.lean ?? '-'}`;
    expect(quarter.map(key).sort()).toEqual(swapped.map(key).sort());
  });

  it('at 30 degrees every cover spot stands just off one of its faces and faces the box', () => {
    const spots = coverPointsFromBoxes([wall]);
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      expect(distanceToBoxM(wall, spot.xM, 0.5, spot.zM)).toBeCloseTo(0.45, 6);
      const forward = { x: -Math.sin(spot.facingYawRad), z: -Math.cos(spot.facingYawRad) };
      expect(forward.x * (wall.xM - spot.xM) + forward.z * (wall.zM - spot.zM)).toBeGreaterThan(0);
    }
  });

  it('footsteps on top of a turned box hear its surface; beside it, the floor', () => {
    const top = toWorld(wall, 1.8, 0);
    const metal: RoomBox = { ...wall, surface: 'tile' };
    expect(surfaceAt(top.x, 1.2, top.z, [metal], [])).toBe('tile');
    expect(surfaceAt(1.8, 0, 0.6, [metal], [])).toBe('concrete');
  });
});

describe('a turned pane of glass', () => {
  // A room cut in two by a wall along a line turned 30 degrees, with a 6 m floor pane in its middle: the walls run past the
  // floor's edges, so the only way across is through the pane.
  const yaw = 30;
  const piece = (x: number, widthM: number, glass?: boolean): RoomBox => {
    const at = turned(x, 0, yaw);
    return { kind: glass ? 'prop' : 'wall', xM: at.x, zM: at.z, widthM, depthM: glass ? 0.2 : 0.4, heightM: glass ? 2.4 : 3, yawDeg: yaw, ...(glass ? { glass: true } : {}) };
  };
  const boxes = [piece(-13, 20), piece(13, 20), piece(0, 6, true)];
  const layout: RoomLayout = { size: { widthM: 20, depthM: 20 }, floors: [], hazards: [] };
  const southSide = turned(0, 5, yaw);
  const northSide = turned(0, -5, yaw);
  let navigation: Navigation;
  let level: ReturnType<typeof buildGreybox>;
  beforeAll(async () => {
    level = buildGreybox(boxes, layout);
    navigation = await Navigation.create(level.navigationGeometryWithoutFloorGlass, {}, level.floorGlass);
  });

  const reaches = (): boolean => {
    const path: Vector3[] = [];
    navigation.findPath(new Vector3(southSide.x, 0, southSide.z), new Vector3(northSide.x, 0, northSide.z), path);
    const last = path[path.length - 1];
    return path.length > 0 && Math.hypot(last.x - northSide.x, last.z - northSide.z) < 0.6;
  };

  it('its obstacle on the navigation mesh is turned with it: closed while whole, open once broken', () => {
    expect(reaches()).toBe(false);
    navigation.openPane(level.floorGlass[0].id);
    expect(reaches()).toBe(true);
    navigation.closePane(level.floorGlass[0].id);
    expect(reaches()).toBe(false);
  });

  it('a bullet through its middle crosses it; one through a corner of its square outline does not', () => {
    const pane = level.glass.panes[0];
    const out = new Vector3();
    expect(level.glass.crossing(pane, new Vector3(southSide.x, 1.2, southSide.z), new Vector3(northSide.x, 1.2, northSide.z), out)).toBe(true);
    expect(overFootprint(pane.box, out.x, out.z, 0.001)).toBe(true);
    const corner = new Vector3(pane.bounds.max.x - 0.05, 1.2, pane.bounds.max.z - 0.05);
    expect(level.glass.crossing(pane, new Vector3(corner.x, 1.2, corner.z + 3), new Vector3(corner.x, 1.2, corner.z - 0.2), out)).toBe(false);
  });

  it('a blast measures to the turned pane itself', () => {
    const pane = level.glass.panes[0];
    const beside = turned(0, 1.5, yaw); // 1.5 m off its middle, square to it
    expect(level.glass.blast(new Vector3(beside.x, 1, beside.z), 1.3)).toEqual([]);
    expect(level.glass.blast(new Vector3(beside.x, 1, beside.z), 1.5)).toEqual([pane]);
  });
});

describe('the format and the editor', () => {
  const level = (): LevelData => ({
    formatVersion: 4,
    name: 'small',
    floor: { widthM: 20, depthM: 20, surfaces: [], hazards: [] },
    start: { id: 'start', xM: 0, zM: 8, yawDeg: 0 },
    dummies: [{ id: 'dummy-1', xM: 2, zM: 6, yawDeg: 180 }],
    spawns: [],
    boxes: [
      { id: 'crate', label: 'crate', kind: 'prop', xM: 0, zM: 0, widthM: 2, depthM: 1, heightM: 1 },
      { id: 'bench', label: 'bench', kind: 'prop', xM: 5, zM: 0, widthM: 4, depthM: 1, heightM: 1, yawDeg: 30 },
    ],
    coverAdd: [],
    coverRemove: [],
    acousticZones: [],
    speakers: [],
    arrivals: [],
  });
  const box = (l: LevelData, id: string) => picked(l, id) as LevelData['boxes'][number];

  it('a turn is written and read back; a square box leaves the field out', () => {
    const text = levelToJson(level());
    expect(text.split('\n').find((line) => line.includes('"id":"bench"'))).toContain('"yawDeg":30');
    expect(text.split('\n').find((line) => line.includes('"id":"crate"'))).not.toContain('yawDeg');
    expect(checkLevel(JSON.parse(text)).boxes[1].yawDeg).toBe(30);
  });

  it('R swaps a square box as before, and turns a turned one a further 90 degrees', () => {
    expect([box(turn(level(), 'crate'), 'crate').widthM, box(turn(level(), 'crate'), 'crate').yawDeg]).toEqual([1, undefined]);
    expect(box(turn(level(), 'bench'), 'bench').yawDeg).toBe(120);
  });

  it('the ring turns each selected piece about its own centre, and back to square drops the field', () => {
    const next = turnByMany(level(), ['crate', 'bench', 'dummy-1'], 45);
    expect([box(next, 'crate').yawDeg, box(next, 'bench').yawDeg, picked(next, 'dummy-1')!.yawDeg]).toEqual([45, 75, 225]);
    expect([box(next, 'crate').xM, box(next, 'bench').xM]).toEqual([0, 5]);
    expect(box(turnByMany(level(), ['bench'], -30), 'bench').yawDeg).toBeUndefined();
    expect(box(turnByMany(level(), ['bench'], -60), 'bench').yawDeg).toBe(330);
  });

  it('aiming picks a turned box where it is drawn, not in the corners of its square outline', () => {
    const bench = level().boxes[1];
    const end = toWorld(bench, 1.8, 0);
    expect(pickAt(level(), { x: end.x, y: 5, z: end.z }, { x: 0, y: -1, z: 0 })).toBe('bench');
    const outline = worldBounds(bench);
    expect(pickAt(level(), { x: outline.max.x - 0.05, y: 5, z: outline.max.z - 0.05 }, { x: 0, y: -1, z: 0 })).toBeNull();
  });

  it("a turned box's size handles sit on its own faces, and pulling its east face grows it along its own axis", () => {
    const quarter: LevelData = { ...level(), boxes: [{ ...level().boxes[0], yawDeg: 90 }] };
    const east = layoutGizmo(quarter, ['crate'], 'size', { x: 0, y: 1.5, z: 10 }).find((h) => h.key === 'size-east')!;
    expect(east.dir.x).toBeCloseTo(0, 9); // its own +x points north (-z) once turned a quarter left
    expect(east.dir.z).toBeCloseTo(-1, 9);
    expect(east.origin.z).toBeCloseTo(-1, 9); // its east face is 1 m north of its centre
    const grown = box(resizeFace(quarter, 'crate', 'east', 1), 'crate');
    expect(grown.widthM).toBe(3);
    expect(grown.zM).toBeCloseTo(-0.5, 9); // the far face stays where it was
    expect(grown.xM).toBeCloseTo(0, 9);
  });

  it('the ring can be aimed at from above and dragging it turns the selection', () => {
    const ring = layoutGizmo(level(), ['crate'], 'move', { x: 0, y: 6, z: 6 }).find((h) => h.key === 'turn')!;
    const r = ring.scale * 1.3;
    const eye = { x: 0, y: 6, z: 0 };
    const onRing = { x: ring.origin.x + r, y: ring.origin.y, z: ring.origin.z };
    const length = Math.hypot(onRing.x - eye.x, onRing.y - eye.y, onRing.z - eye.z);
    const dir = { x: (onRing.x - eye.x) / length, y: (onRing.y - eye.y) / length, z: (onRing.z - eye.z) / length };
    expect(pickHandle([ring], eye, dir)?.key).toBe('turn');
    expect(ringAngle(ring, eye, dir)!.angleRad).toBeCloseTo(0, 6); // +x is angle 0
    expect(pickHandle([ring], eye, { x: 0, y: -1, z: 0 })).toBeNull(); // straight down at the centre: inside the ring
    expect(box(applyHandleDrag(level(), ['crate'], ring, 15), 'crate').yawDeg).toBe(15);
  });
});
