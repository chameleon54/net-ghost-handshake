import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { chamberLevel } from '../src/data/chamber';
import { levelLayout, spotRad } from '../src/level/levelData';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { CoverPoints, levelCover, type CoverPoint } from '../src/level/cover';
import { Input } from '../src/core/input';
import { Player } from '../src/player/player';
import { EventBus } from '../src/core/events';
import { StandInEnemy, type StandInShot } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import { SquadCoordinator } from '../src/squad/squadCoordinator';
import { aggressionSetting } from '../src/config/aggression';
import { loopConfig } from '../src/config/loop';
import { standInConfig } from '../src/config/standInEnemy';
import type { WeaponEvents } from '../src/weapons/events';

// The grey-box central chamber (5.3, decision 274; layout.md pass 3): the checks a test can make of "three entrances,
// looping routes, no campable chokepoint". How it plays is the owner's playtest.

const level = buildGreybox(chamberLevel.boxes, levelLayout(chamberLevel));
let navigation: Navigation;
let cover: CoverPoint[];
const upM = 4.5;
const route: Vector3[] = [];

/** Just inside each floor door, at chest height: what "seeing a door" means here. */
const doorMouths = {
  N: new Vector3(6, 1.2, -11.5),
  S: new Vector3(-6, 1.2, 11.5),
  W: new Vector3(-14.5, 1.2, 5),
  E: new Vector3(14.5, 1.2, 3),
};
/** In each alcove, where a squad gathers. */
const alcoves = { N: new Vector3(6, 0, -13.8), S: new Vector3(-6, 0, 13.5), W: new Vector3(-16.5, 0, 5), E: new Vector3(16.5, 0, 3) };

/** True if nothing stands between the two points. */
function clear(from: Vector3, to: Vector3): boolean {
  const direction = to.clone().sub(from);
  const m = direction.length();
  return level.collision.rayDistance(from, direction.normalize(), m) >= m - 0.05;
}

/** The route's end is within `withinM` of `to` (the navigation mesh got there). */
function reaches(from: Vector3, to: Vector3, withinM = 0.5): boolean {
  return navigation.findPath(from, to, route) && route.length > 0 && route[route.length - 1].distanceTo(to) <= withinM;
}

beforeAll(async () => {
  navigation = await Navigation.create(level.navigationGeometry);
  const onMesh = new Vector3();
  cover = levelCover(chamberLevel).filter((p) => {
    const feet = new Vector3(p.xM, 0, p.zM);
    return navigation.closestPoint(feet, onMesh) && Math.hypot(onMesh.x - feet.x, onMesh.z - feet.z) < 0.05;
  });
});

describe('the central chamber (5.3)', () => {
  it('loads through the checker with its four entrances, spawns and pieces', () => {
    expect(chamberLevel.name).toBe('chamber');
    expect(chamberLevel.arrivals).toHaveLength(4);
    expect(chamberLevel.spawns).toHaveLength(8);
    expect(chamberLevel.boxes.filter((b) => b.glass)).toHaveLength(1);
  });

  it('routes from every alcove to the middle, the laptop bench, the stairs and every other alcove', () => {
    const targets = [new Vector3(-1, 0, 6), new Vector3(-7.5, 0, -2.4), new Vector3(-14.25, 0, 0), ...Object.values(alcoves)];
    for (const [name, from] of Object.entries(alcoves)) {
      for (const to of targets) expect(reaches(from, to), `${name} alcove to (${to.x}, ${to.z})`).toBe(true);
    }
  });

  it('the navigation mesh covers both stairs and the upper level (routes up there come with 5.3b)', () => {
    // shortcut: Navigation's queries still snap to the floor (its onFloor), so this checks the mesh's triangles, not routes;
    // 5.3b makes the queries work on every level and turns this into route checks.
    const [positions] = navigation.triangles();
    const covered = (x: number, y: number, z: number) => {
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i] - x) < 1.5 && Math.abs(positions[i + 1] - y) < 0.3 && Math.abs(positions[i + 2] - z) < 1.5) return true;
      }
      return false;
    };
    const places = { 'NW catwalk': [-8, upM, -11], core: [4, upM, -7.8], 'ring W': [-16.5, upM, 0], 'ring S': [0, upM, 13.5], 'ring E': [16.5, upM, -6], 'W stairs': [-14.25, 2.3, -5.5], 'S stairs': [8.5, 2.3, 11.25] } as const;
    for (const [name, [x, y, z]] of Object.entries(places)) expect(covered(x, y, z), name).toBe(true);
  });

  it('no spot on the floor sees all four doors; the core cannot see the north door', () => {
    let points = 0;
    let mostDoors = 0;
    for (let x = -14.5; x <= 14.5; x += 1) {
      for (let z = -11.5; z <= 11.5; z += 1) {
        const feet = new Vector3(x, 0, z);
        if (level.collision.overlapsCapsule(feet, 0.3, 1.8, 0.01)) continue; // inside a piece
        const eyes = new Vector3(x, 1.6, z);
        const seen = Object.values(doorMouths).filter((door) => clear(eyes, door)).length;
        mostDoors = Math.max(mostDoors, seen);
        points++;
      }
    }
    expect(points).toBeGreaterThan(400);
    expect(mostDoors).toBeLessThan(4);
    for (let x = -1; x <= 9; x += 1) for (let z = -11.5; z <= -7.5; z += 1) expect(clear(new Vector3(x, upM + 1.6, z), doorMouths.N)).toBe(false);
  });

  it('has cover across the floor that enemies can reach', () => {
    expect(cover.length).toBeGreaterThanOrEqual(60);
    const unreachable = cover.filter((p) => !reaches(alcoves.W, new Vector3(p.xM, 0, p.zM), standInConfig.coverArriveM));
    expect(unreachable).toEqual([]);
  });
});

describe('Rook in the chamber (5.3)', () => {
  const dtSec = 1 / 60;
  /**
   * Rook at (x, y, z) facing `yawRad`, holding W (and Shift to sprint) for `seconds`: where he ended, and how long he was
   * off the ground on the way.
   */
  const walk = (xM: number, zM: number, yawRad: number, seconds: number, y = 0, sprint = false) => {
    const input = new Input();
    input.enabled = true;
    const player = new Player(level.collision, { xM, zM, yawRad });
    player.position.y = y;
    input.keyDown('KeyW');
    if (sprint) input.keyDown('ShiftLeft');
    let airSec = 0;
    for (let i = 0; i < Math.round(seconds / dtSec); i++) {
      player.fixedUpdate(dtSec, input);
      if (!player.grounded) airSec += dtSec;
    }
    return { at: player.position, airSec };
  };
  // A flight is 9 m long: at walking speed (4 m/s) about 2.3 s, sprinting (6.5 m/s) about 1.4 s.

  it('walks up the west stairs at walking speed onto the NW catwalk, and back down without skipping', () => {
    const up = walk(-14.25, 0, 0, 2.9); // facing north
    expect(up.at.y).toBeCloseTo(upM, 1);
    expect(up.at.z).toBeLessThan(-10);
    expect(up.airSec).toBe(0);
    const down = walk(-14.25, -10.8, Math.PI, 2.9, upM); // facing south from the catwalk
    expect(down.at.y).toBeCloseTo(0, 1);
    expect(down.at.z).toBeGreaterThan(-1);
    expect(down.airSec).toBeLessThan(0.05); // it stays on the ramp (at most a frame stepping onto it), no hops
  });

  it('sprints up and down the stairs at sprinting speed', () => {
    expect(walk(-14.25, 0, 0, 1.9, 0, true).at.y).toBeCloseTo(upM, 1);
    const down = walk(-14.25, -10.8, Math.PI, 1.9, upM, true);
    expect(down.at.y).toBeCloseTo(0, 1);
    expect(down.airSec).toBeLessThan(0.05);
  });

  it('walks up the south stairs to the landing and through the doorway into the ring', () => {
    const up = walk(3.5, 11.25, -Math.PI / 2, 2.9); // facing east
    expect(up.at.y).toBeCloseTo(upM, 1);
    expect(up.at.x).toBeGreaterThan(13);
    const ring = walk(14, 11.25, Math.PI, 2, upM); // facing south, through the doorway
    expect(ring.at.y).toBeCloseTo(upM, 1);
    expect(ring.at.z).toBeGreaterThan(12.5);
  });

  it("still falls off a real edge: through the NE catwalk's climb gap he drops onto the 3 m cabinet, not snapped", () => {
    const off = walk(11.75, -11, Math.PI, 2, upM); // facing south, through the gap in the parapet
    expect(off.at.y).toBeLessThan(upM - 1);
  });

  it("the steps are drawn but not solid, and each stair's ramp is solid but not drawn", () => {
    const steps = chamberLevel.boxes.filter((b) => b.label.includes('stairs step'));
    const ramps = chamberLevel.boxes.filter((b) => b.ramp);
    expect(steps).toHaveLength(36);
    expect(steps.every((b) => b.solid === false && b.drawn !== false)).toBe(true);
    expect(ramps.map((b) => b.ramp)).toEqual(['north', 'east']);
    expect(ramps.every((b) => b.drawn === false && b.solid !== false)).toBe(true);
  });
});

describe('a squad in the chamber (5.3)', () => {
  it('four enemies from the alcoves wake, reach cover and fire at Rook standing at the start', () => {
    aggressionSetting.current = 'assertive';
    const start = spotRad(chamberLevel.start);
    const rook = {
      position: new Vector3(start.xM, 0, start.zM),
      eyeHeightNowM: 1.6,
      eyes: new Vector3(start.xM, 1.6, start.zM),
      forward: new Vector3(0, 0, -1),
      inView: () => true,
      exposure: 0.9,
      movingFast: false,
    };
    const points = new CoverPoints(cover, level.collision);
    const squad = new SquadCoordinator();
    const shots: StandInShot[] = [];
    const members = chamberLevel.spawns.slice(0, 4).map((spawn) => {
      const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, points, rook, () => {}, () => [], Math.random, squad);
      const fire = world.fire.bind(world);
      world.fire = (enemy, shot) => {
        shots.push(shot);
        fire(enemy, shot);
      };
      return { enemy: new StandInEnemy(spotRad(spawn), world), world };
    });
    const enemies = members.map((m) => m.enemy);
    for (const m of members) m.world.squadmates = enemies;
    const shot = { kind: 'rifle-shot' as const, position: rook.position, radiusM: 60 };
    const stepSec = 1 / loopConfig.updateRateHz;
    for (let i = 0; i < 20 * loopConfig.updateRateHz; i++) {
      if (i % (2 * loopConfig.updateRateHz) === 0) for (const e of enemies) e.hear(shot);
      squad.update(stepSec, rook.position, false);
      for (const { enemy, world } of members) {
        enemy.update(stepSec, rook.position);
        world.glimpse(enemy, stepSec);
      }
    }
    expect(enemies.every((e) => e.awake)).toBe(true);
    expect(enemies.filter((e) => e.cover !== null).length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBeGreaterThan(0);
  });
});
