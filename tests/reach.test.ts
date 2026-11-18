import { beforeAll, describe, expect, it } from 'vitest';
import { chamberLevel } from '../src/data/chamber';
import { playerConfig } from '../src/config/player';
import { levelLayout, type LevelData } from '../src/level/levelData';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { describeReach, newSince, reachProblems, type ReachProblem } from '../src/level/reach';
import { moveBy, setField } from '../src/level/levelEdit';

// The level editor's reach check (5.2b, decision 281), on the chamber.

/** The problems of a layout, from meshes built as the editor builds them. */
async function check(level: LevelData): Promise<ReachProblem[]> {
  const built = buildGreybox(level.boxes, levelLayout(level));
  const enemies = await Navigation.create(built.navigationGeometry);
  const rook = await Navigation.create(built.navigationGeometry, { agentRadiusM: playerConfig.capsuleRadiusM, agentHeightM: playerConfig.crouchHeightM });
  const problems = reachProblems(level, enemies, rook);
  enemies.dispose();
  rook.dispose();
  return problems;
}

let baseline: ReachProblem[];
beforeAll(async () => {
  baseline = await check(chamberLevel);
});

describe('the reach check (5.2b)', () => {
  it('the chamber as it is: no spawn is cut off, and nothing new to report against itself', () => {
    expect(baseline.filter((p) => p.kind === 'spawn-no-route')).toEqual([]);
    expect(baseline.filter((p) => p.kind === 'start-off-floor')).toEqual([]);
    expect(newSince(baseline, baseline)).toEqual([]);
    expect(describeReach(chamberLevel, baseline, [])[0]).toBe('nothing new is out of reach');
  });

  it('a wall across the W alcove cuts that spawn off, and the report names it', async () => {
    const level: LevelData = { ...chamberLevel, boxes: [...chamberLevel.boxes, { id: 'test-block', label: 'test block', kind: 'wall', xM: -15.15, zM: 5, widthM: 0.6, depthM: 3, heightM: 3 }] };
    const fresh = newSince(await check(level), baseline);
    const spawn = chamberLevel.spawns.find((s) => s.xM < -15)!; // the W alcove's
    expect(fresh.some((p) => p.kind === 'spawn-no-route' && p.key.endsWith(spawn.id))).toBe(true);
    expect(fresh.some((p) => p.kind === 'enemy-pocket')).toBe(true); // the alcove itself is closed off too
    expect(describeReach(level, await check(level), fresh)[0]).toContain('spawn with no route to the start');
  });

  it('a ring prop pushed against the outer wall leaves its cover off the floor or out of reach', async () => {
    const desk = chamberLevel.boxes.find((b) => b.id === 'ring-s-locker')!;
    const moved = setField(moveBy(chamberLevel, desk.id, 0, 0, 0.3), desk.id, 'depthM', 1.6); // now it fills most of the walkway
    const fresh = newSince(await check(moved), baseline);
    expect(fresh.some((p) => p.kind === 'cover-off-floor' || p.kind === 'cover-no-route' || p.kind === 'enemy-pocket')).toBe(true);
  });

  it('blocking the top of the W stairs closes nothing off: the S stairs still lead up', async () => {
    const level: LevelData = { ...chamberLevel, boxes: [...chamberLevel.boxes, { id: 'test-plug', label: 'test plug', kind: 'wall', xM: -14.25, yM: 4.5, zM: -10.2, widthM: 1.6, depthM: 0.6, heightM: 3 }] };
    const fresh = newSince(await check(level), baseline);
    expect(fresh.filter((p) => p.kind === 'spawn-no-route')).toEqual([]);
  });
});
