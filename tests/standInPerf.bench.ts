import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { testArena, testArenaLayout, testArenaStandIns } from '../src/data/testArena';
import { StandInEnemy } from '../src/enemies/standInEnemy';
import { StandInWorld } from '../src/enemies/standInWorld';
import { EventBus } from '../src/core/events';
import { CoverPoints, coverPointsFromBoxes } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { SquadCoordinator } from '../src/squad/squadCoordinator';
import { aggressionSetting } from '../src/config/aggression';
import { enemyGrenadeConfig } from '../src/config/enemyGrenades';
import { grenadeConfig } from '../src/config/grenade';
import { loopConfig } from '../src/config/loop';
import type { WeaponEvents } from '../src/weapons/events';
import type { Noise } from '../src/stealth/noise';

// The performance check's timing run (4.13b, decision 258), without the browser: `npm run bench`. Not part of `npm test`.
// It times, on this PC: one game update of 8 stand-ins in a fight, each squad plan once, one ray and one route search.
// The numbers are for comparing before and after a change; whether 60 fps holds is judged in the browser (the dev
// panel's performance readout), where the readout's ray and route counts times the costs here give their share.
//
// shortcut: the squad's own orchestration (flanks, pushes, the hunt, grenades) lives in main.ts and is not run here, so
// the update row is the stand-ins' own thinking; the plan rows time what that orchestration calls. Move the
// orchestration out of main.ts if a full headless fight is ever needed.

const level = buildGreybox(testArena, testArenaLayout);
let navigation: Navigation;
let cover: CoverPoints;
const stepSec = 1 / loopConfig.updateRateHz;
const warmUpSteps = 10 * loopConfig.updateRateHz; // 10 s: long enough for the squad to be in cover and peeking
const shotEverySteps = 2 * loopConfig.updateRateHz; // Rook fires every 2 s, so they keep knowing where he is
const shotHeardFarM = 60; // the whole arena hears it

/** Rook crouched behind the south-west bench, looking north (the spot the arena tests use). */
const rook = {
  position: new Vector3(-6, 0, 7.1),
  eyeHeightNowM: 1,
  eyes: new Vector3(-6, 1, 7.1),
  forward: new Vector3(0, 0, -1),
  inView: () => true,
  exposure: 0,
  movingFast: false,
};
const shot: Noise = { kind: 'rifle-shot', position: rook.position, radiusM: shotHeardFarM };

function makeSquad() {
  const squad = new SquadCoordinator();
  const members = testArenaStandIns.map((spawn) => {
    const world = new StandInWorld(new EventBus<WeaponEvents>(), level.collision, navigation, cover, rook, () => {}, () => [], Math.random, squad);
    return { enemy: new StandInEnemy(spawn, world), world };
  });
  const enemies = members.map(({ enemy }) => enemy);
  for (const { world } of members) world.squadmates = enemies; // each keeps its line of fire clear of the others (4.16)
  return members;
}

beforeAll(async () => {
  navigation = await Navigation.create(level.navigationGeometry);
  const feet = new Vector3();
  const onMesh = new Vector3();
  const points = coverPointsFromBoxes(testArena).filter((p) => {
    feet.set(p.xM, 0, p.zM);
    return navigation.closestPoint(feet, onMesh) && Math.hypot(onMesh.x - feet.x, onMesh.z - feet.z) < 0.05;
  });
  cover = new CoverPoints(points, level.collision);
  aggressionSetting.current = 'relentless';
});

test('8 stand-ins: one update step, and what it costs to plan, cast a ray and find a route', async ({ bench }) => {
  // The fight: all 8 hear Rook's shot and close in; after the warm-up every step is timed, the fight going on.
  const squad = makeSquad();
  let step = 0;
  const update = () => {
    if (step % shotEverySteps === 0) for (const { enemy } of squad) enemy.hear(shot);
    for (const { enemy, world } of squad) {
      enemy.update(stepSec, rook.position);
      world.glimpse(enemy, stepSec);
    }
    step++;
  };
  for (let i = 0; i < warmUpSteps; i++) update();
  expect(squad.every(({ enemy }) => enemy.awake && enemy.state !== 'idle'), 'all 8 are in the fight').toBe(true);
  const states = new Set<string>();
  const steps = 60 * loopConfig.updateRateHz;
  for (let i = 0; i < steps; i++) {
    update();
    for (const { enemy } of squad) states.add(enemy.state);
  }
  console.log(`states seen in a minute of the fight: ${[...states].join(', ')}`);

  // The plans, each from a fresh trooper and flanker at their spawns (the arena tests check these find something).
  const [planner] = makeSquad().filter(({ enemy }) => enemy.role === 'trooper');
  const [flanker] = makeSquad().filter(({ enemy }) => enemy.role === 'flanker');
  const throwFrom = cover.points.find((p) => {
    const m = Math.hypot(p.xM - rook.position.x, p.zM - rook.position.z);
    return m >= enemyGrenadeConfig.throwMinM && m <= enemyGrenadeConfig.throwMaxM && cover.hides(p, rook.eyes) && planner.world.planThrow(planner.enemy, p) !== null;
  })!;

  // A grenade 3 m in front of the trooper, to run from (the blast radius as the safe distance).
  const fleeFrom = new Vector3(planner.enemy.xM, 0, planner.enemy.zM + 3);
  const fleeSafeM = grenadeConfig.blastRadiusM;
  const fleeTo = new Vector3();

  // One ray across the arena, and one route from the north-west corner to Rook.
  const rayFrom = new Vector3(-13.5, 1.5, -9.5);
  const rayDirection = new Vector3().subVectors(rook.eyes, rayFrom);
  const rayM = rayDirection.length();
  rayDirection.normalize();
  const routeFrom = new Vector3(-13.5, 0, -9.5);
  const route: Vector3[] = [];

  await bench.compare(
    bench('one update step, 8 stand-ins fighting (Relentless)', update),
    bench('pickCover (a trooper)', () => planner.world.pickCover(planner.enemy)),
    bench('planAdvance (a trooper)', () => planner.world.planAdvance(planner.enemy)),
    bench('planThrow (a trooper)', () => planner.world.planThrow(planner.enemy, throwFrom)),
    bench('planFlank (a flanker)', () => flanker.world.planFlank(flanker.enemy)),
    bench('planFlee (a trooper, from a grenade 3 m away)', () => planner.world.planFlee(planner.enemy, fleeFrom, fleeSafeM, fleeTo)),
    bench('one ray across the arena', () => level.collision.rayDistance(rayFrom, rayDirection, rayM)),
    bench('one route search across the arena', () => navigation.findPath(routeFrom, rook.position, route)),
  );
});
