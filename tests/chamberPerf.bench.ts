import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { chamberLevel } from '../src/data/chamber';
import { levelLayout, spotRad } from '../src/level/levelData';
import { StandInEnemy } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import { EventBus } from '../src/core/events';
import { CoverPoints, levelCover } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { SquadCoordinator } from '../src/squad/squadCoordinator';
import { aggressionSetting } from '../src/config/aggression';
import { loopConfig } from '../src/config/loop';
import type { WeaponEvents } from '../src/weapons/events';
import type { Noise } from '../src/stealth/noise';

// The two-storey performance check (5.3c, decision 261), as 4.13b's arena run (standInPerf.bench.ts) but in the central
// chamber: 8 stand-ins fighting Rook on the floor, and Rook on the ring (routes and sight across both storeys, cover on
// the upper level). `npm run bench`; not part of `npm test`. Same shortcut as the arena run: main.ts's orchestration
// (flanks, pushes, the storey push, grenades) is not run here; its plans are timed one by one.

const level = buildGreybox(chamberLevel.boxes, levelLayout(chamberLevel));
let navigation: Navigation;
let cover: CoverPoints;
const stepSec = 1 / loopConfig.updateRateHz;
const warmUpSteps = 10 * loopConfig.updateRateHz;
const shotEverySteps = 2 * loopConfig.updateRateHz;
const shotHeardFarM = 80; // the whole chamber hears it

function quarry(x: number, y: number, z: number) {
  return { position: new Vector3(x, y, z), eyeHeightNowM: 1, eyes: new Vector3(x, y + 1, z), forward: new Vector3(0, 0, -1), inView: () => true, exposure: 0, movingFast: false };
}

function fight(rook: ReturnType<typeof quarry>) {
  const squad = new SquadCoordinator();
  const members = chamberLevel.spawns.map((spawn) => {
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {}, () => [], Math.random, squad);
    return { enemy: new StandInEnemy(spotRad(spawn), world), world };
  });
  const enemies = members.map(({ enemy }) => enemy);
  for (const { world } of members) world.squadmates = enemies;
  const shot: Noise = { kind: 'rifle-shot', position: rook.position, radiusM: shotHeardFarM };
  let step = 0;
  const update = () => {
    if (step % shotEverySteps === 0) for (const enemy of enemies) enemy.hear(shot, rook.position.y);
    for (const { enemy, world } of members) {
      enemy.update(stepSec, rook.position);
      world.glimpse(enemy, stepSec);
    }
    step++;
  };
  for (let i = 0; i < warmUpSteps; i++) update();
  expect(enemies.every((enemy) => enemy.awake && enemy.state !== 'idle'), 'all 8 are in the fight').toBe(true);
  return { members, update };
}

beforeAll(async () => {
  navigation = await Navigation.create(level.navigationGeometry);
  const onMesh = new Vector3();
  const points = levelCover(chamberLevel).filter((p) => {
    const feet = new Vector3(p.xM, p.yM ?? 0, p.zM);
    return navigation.closestPoint(feet, onMesh) && Math.hypot(onMesh.x - feet.x, onMesh.z - feet.z) < 0.05 && Math.abs(onMesh.y - feet.y) < 0.5;
  });
  cover = new CoverPoints(points, level.collision);
  aggressionSetting.current = 'relentless';
});

test('the chamber, 8 stand-ins: Rook on the floor and on the ring', async ({ bench }) => {
  const onFloor = fight(quarry(-6, 0, 10.5)); // Rook's start, inside the S door
  const ringRook = quarry(0, 4.5, 13.5); // the south ring, over the S door
  const onRing = fight(ringRook);
  const [planner] = onRing.members.filter(({ enemy }) => enemy.role === 'trooper');
  const [flanker] = onRing.members.filter(({ enemy }) => enemy.role === 'flanker');
  const routeFrom = new Vector3(16.5, 0, 3); // the E alcove, up a stair and round the ring to him
  const route: Vector3[] = [];

  await bench.compare(
    bench('one update step, 8 fighting, Rook on the floor', onFloor.update),
    bench('one update step, 8 fighting, Rook on the ring', onRing.update),
    bench('pickCover (a trooper, Rook on the ring)', () => planner.world.pickCover(planner.enemy)),
    bench('planAdvance (a trooper, Rook on the ring)', () => planner.world.planAdvance(planner.enemy)),
    bench('planFlank (a flanker, Rook on the ring)', () => flanker.world.planFlank(flanker.enemy)),
    bench('one route search, E alcove up to the ring', () => navigation.findPath(routeFrom, ringRook.position, route)),
  );
});
