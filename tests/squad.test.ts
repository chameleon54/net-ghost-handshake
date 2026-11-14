import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { squadConfig } from '../src/config/squad';
import { greyboxStandIns } from '../src/data/greyboxEnemies';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';
import { SquadCoordinator } from '../src/squad/squadCoordinator';

describe('SquadCoordinator firing slots (4.6)', () => {
  it('never hands out more slots than allowed; a holder keeps its slot; a given-back slot can be taken', () => {
    const squad = new SquadCoordinator();
    const [a, b, c] = [{}, {}, {}];
    expect(squad.requestSlot(a)).toBe(true);
    expect(squad.requestSlot(b)).toBe(squadConfig.firingSlots >= 2);
    expect(squad.requestSlot(c)).toBe(squadConfig.firingSlots >= 3);
    expect(squad.slotsHeld).toBe(Math.min(squadConfig.firingSlots, 3));
    expect(squad.requestSlot(a)).toBe(true); // asking again while holding one
    expect(squad.slotsHeld).toBe(Math.min(squadConfig.firingSlots, 3));
    squad.releaseSlot(a);
    expect(squad.holdsSlot(a)).toBe(false);
    expect(squad.requestSlot(c)).toBe(true);
    squad.reset();
    expect(squad.slotsHeld).toBe(0);
  });
});

describe('SquadCoordinator hit budget (4.6)', () => {
  it('allows one hit per window for the whole squad, whoever lands it', () => {
    const squad = new SquadCoordinator();
    expect(squad.mayHit()).toBe(true);
    squad.hitLanded(); // one enemy hits
    expect(squad.mayHit()).toBe(false); // so no one else may
    squad.update(squadConfig.hitGapSec - 0.01);
    expect(squad.mayHit()).toBe(false);
    squad.update(0.02);
    expect(squad.mayHit()).toBe(true);
    squad.hitLanded();
    squad.reset();
    expect(squad.mayHit()).toBe(true);
  });
});

describe('the squad spawns in the test room (4.6)', () => {
  it('are four, on the navigation mesh, and at least 2 m apart', async () => {
    const level = buildGreybox();
    const navigation = await Navigation.create(level.navigationGeometry);
    expect(greyboxStandIns).toHaveLength(4);
    const onMesh = new Vector3();
    for (const spawn of greyboxStandIns) {
      const feet = new Vector3(spawn.xM, 0, spawn.zM);
      expect(navigation.closestPoint(feet, onMesh), `${spawn.xM}, ${spawn.zM}`).toBe(true);
      expect(Math.hypot(onMesh.x - feet.x, onMesh.z - feet.z), `${spawn.xM}, ${spawn.zM}`).toBeLessThan(0.05);
      for (const other of greyboxStandIns) {
        if (other !== spawn) expect(Math.hypot(other.xM - spawn.xM, other.zM - spawn.zM)).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
