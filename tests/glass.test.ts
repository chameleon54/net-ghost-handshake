import { beforeAll, describe, expect, test } from 'vitest';
import { Scene, Vector3 } from 'three';
import { GlassFx } from '../src/fx/glassFx';
import { EventBus } from '../src/core/events';
import type { RoomBox, RoomLayout } from '../src/data/greyboxRoom';
import { glassConfig } from '../src/config/glass';
import { buildGreybox } from '../src/level/greybox';
import { GlassSystem } from '../src/level/glassSystem';
import { Navigation } from '../src/level/navigation';
import type { WeaponEvents } from '../src/weapons/events';

// A 20 m by 20 m room cut in two by a wall along z = 0, with a 6 m gap in the middle filled by a floor-standing pane (index 2)
// and a raised pane (index 3) floating over the north half, like a parapet.
const layout: RoomLayout = { size: { widthM: 20, depthM: 20 }, floors: [], hazards: [] };
const boxes: RoomBox[] = [
  { kind: 'wall', xM: -6.5, zM: 0, widthM: 7, depthM: 0.4, heightM: 3 },
  { kind: 'wall', xM: 6.5, zM: 0, widthM: 7, depthM: 0.4, heightM: 3 },
  { kind: 'prop', xM: 0, zM: 0, widthM: 6, depthM: 0.2, heightM: 2.4, glass: true },
  { kind: 'prop', xM: 0, zM: -6, widthM: 4, depthM: 0.1, heightM: 1, yM: 4.5, glass: true },
];
const floorPane = 'glass-2';
const raisedPane = 'glass-3';

function setup() {
  const level = buildGreybox(boxes, layout);
  const events = new EventBus<WeaponEvents>();
  return { level, events };
}

/** A shot from `from` to `to`, as the shooters announce it. */
function shoot(events: EventBus<WeaponEvents>, from: Vector3, to: Vector3, shooter: 'player' | 'enemy' = 'player') {
  events.emit('shot:landed', { muzzle: from, end: to, hit: false, normal: new Vector3(0, 1, 0), shooter });
}

const south = new Vector3(0, 1.2, 5);
const north = new Vector3(0, 1.2, -5);

describe('glass panes', () => {
  test('only solid glass boxes become panes, and the raised one does not stand on the floor', () => {
    const { level } = setup();
    expect(level.glass.panes.map((pane) => pane.id)).toEqual([floorPane, raisedPane]);
    expect(level.floorGlass.map((pane) => pane.id)).toEqual([floorPane]);
  });

  test('intact glass blocks walking but not rays; a broken pane blocks nothing', () => {
    const { level, events } = setup();
    new GlassSystem(events, level, Navigation.unavailable());
    expect(level.collision.overlapsCapsule(new Vector3(0, 0, 0), 0.3, 1.8, 0.01)).toBe(true);
    expect(level.collision.rayDistance(south, new Vector3(0, 0, -1), 20)).toBe(Infinity); // sight passes the glass
    for (let i = 0; i < glassConfig.hitsToBreak; i++) shoot(events, south, north);
    expect(level.glass.panes[0].broken).toBe(true);
    expect(level.collision.overlapsCapsule(new Vector3(0, 0, 0), 0.3, 1.8, 0.01)).toBe(false);
  });

  test('every bullet goes through, the last hit shatters the pane, and later bullets add nothing', () => {
    const { level, events } = setup();
    new GlassSystem(events, level, Navigation.unavailable());
    const cracked: number[] = [];
    const broken: string[] = [];
    events.on('glass:cracked', ({ hits }) => void cracked.push(hits));
    events.on('glass:broken', ({ pane, by }) => broken.push(`${pane.id} by ${by}`));
    for (let i = 0; i < glassConfig.hitsToBreak + 2; i++) shoot(events, south, north, 'enemy');
    expect(cracked).toEqual([1, 2]);
    expect(broken).toEqual([`${floorPane} by enemy`]);
  });

  test('a shot that stops before the pane, or flies beside it, does nothing', () => {
    const { level, events } = setup();
    new GlassSystem(events, level, Navigation.unavailable());
    shoot(events, south, new Vector3(0, 1.2, 1)); // stops short of the pane
    shoot(events, south, new Vector3(8, 1.2, -5)); // crosses the wall line beside the pane (x = 8 is wall, not glass)
    expect(level.glass.panes[0].hits).toBe(0);
  });

  test('a blast shatters only the panes in its radius, at once, and a reset puts them back', () => {
    const { level, events } = setup();
    const system = new GlassSystem(events, level, Navigation.unavailable());
    const by: string[] = [];
    events.on('glass:broken', ({ pane, by: who }) => by.push(`${pane.id} ${who}`));
    events.emit('grenade:exploded', { position: new Vector3(0, 0.5, 2), radiusM: 3 });
    expect(by).toEqual([`${floorPane} blast`]); // the raised pane is 8 m away
    expect(level.glass.panes[1].broken).toBe(false);
    system.reset();
    expect(level.glass.panes.every((pane) => !pane.broken)).toBe(true);
    expect(level.collision.overlapsCapsule(new Vector3(0, 0, 0), 0.3, 1.8, 0.01)).toBe(true);
  });

  test('a pane an enemy line crosses is found, a broken one is not', () => {
    const { level } = setup();
    expect(level.glass.intactOnSegment(south, north)).toBe(true);
    level.glass.blast(new Vector3(0, 0, 0), 1);
    expect(level.glass.intactOnSegment(south, north)).toBe(false);
  });
});

describe('glass effects', () => {
  test('a crack mark appears after a hit, then the pane vanishes, the mark goes and a shard burst flies', () => {
    const { level, events } = setup();
    const scene = new Scene();
    const fx = new GlassFx(scene, events, level.glassMeshes);
    new GlassSystem(events, level, Navigation.unavailable());
    const pooled = scene.children.length; // the shard bursts, ready and hidden
    const pane = level.glassMeshes.get(floorPane)!;
    shoot(events, south, north);
    expect(scene.children.length).toBe(pooled + 1); // one crack mark
    expect(pane.visible).toBe(true);
    for (let i = 1; i < glassConfig.hitsToBreak; i++) shoot(events, south, north);
    expect(scene.children.length).toBe(pooled); // the marks are gone
    expect(pane.visible).toBe(false);
    expect(scene.children.some((child) => child.visible)).toBe(true); // a shard burst
    fx.update(glassConfig.shardLifeSec + 0.1);
    expect(scene.children.some((child) => child.visible)).toBe(false); // and it is over
    fx.clear();
    expect(pane.visible).toBe(true); // a new run: drawn again
  });
});

describe('navigation through a broken floor pane', () => {
  let navigation: Navigation;
  let level: ReturnType<typeof buildGreybox>;
  beforeAll(async () => {
    level = buildGreybox(boxes, layout);
    navigation = await Navigation.create(level.navigationGeometryWithoutFloorGlass, {}, level.floorGlass);
  });

  /** True if a route from the south half reaches the north half. */
  const reachesNorth = (): boolean => {
    const path: Vector3[] = [];
    navigation.findPath(new Vector3(0, 0, 5), new Vector3(0, 0, -5), path);
    return path.length > 0 && Math.hypot(path[path.length - 1].x, path[path.length - 1].z + 5) < 0.6;
  };

  test('the pane is a wall while whole, a gap once opened, and a wall again when closed', () => {
    expect(reachesNorth()).toBe(false);
    navigation.openPane(floorPane);
    expect(reachesNorth()).toBe(true);
    navigation.closePane(floorPane);
    expect(reachesNorth()).toBe(false);
  });

  test('opening a pane the mesh does not know does nothing', () => {
    navigation.openPane(raisedPane);
    expect(reachesNorth()).toBe(false);
  });

  test('a room without floor glass is not changed: the same geometry goes to the solo mesh', () => {
    const plain = buildGreybox([boxes[0], boxes[1]], layout);
    expect(plain.floorGlass).toEqual([]);
    expect(plain.navigationGeometryWithoutFloorGlass).toBe(plain.navigationGeometry);
  });
});
