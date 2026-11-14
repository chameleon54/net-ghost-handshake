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

describe('SquadCoordinator flanking (4.7)', () => {
  const rook = { x: 0, z: 0 };
  const hold = (squad: SquadCoordinator, seconds: number, at = rook) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) squad.update(1 / 60, at);
  };

  it('a flank is due once Rook has held his spot long enough, not before', () => {
    const squad = new SquadCoordinator();
    hold(squad, squadConfig.holdBeforeFlankSec - 0.5);
    expect(squad.flankDue).toBe(false);
    hold(squad, 1);
    expect(squad.flankDue).toBe(true);
  });

  it('small moves keep the clock; moving out of the radius, or the squad losing track of him, starts it again', () => {
    const squad = new SquadCoordinator();
    hold(squad, squadConfig.holdBeforeFlankSec - 1);
    hold(squad, 0.5, { x: squadConfig.holdRadiusM * 0.8, z: 0 });
    expect(squad.heldSec).toBeGreaterThan(squadConfig.holdBeforeFlankSec - 1);
    hold(squad, 0.5, { x: squadConfig.holdRadiusM * 2, z: 0 });
    expect(squad.heldSec).toBeLessThan(1);
    hold(squad, squadConfig.holdBeforeFlankSec - 1);
    squad.update(1 / 60, null);
    expect(squad.heldSec).toBe(0);
  });

  it('gives the job to the cheapest plan, one at a time, with a wait after; with no plan it tries again later', () => {
    const squad = new SquadCoordinator();
    const [a, b] = [{}, {}];
    hold(squad, squadConfig.holdBeforeFlankSec + 0.1);
    expect(squad.assignFlank([a, b], () => null)).toBeNull();
    expect(squad.flankDue).toBe(false); // the retry wait
    hold(squad, squadConfig.flankRetrySec + 0.1);
    expect(squad.flankDue).toBe(true);
    const job = squad.assignFlank([a, b], (m) => ({ cost: m === b ? 1 : 2 }));
    expect(job?.member).toBe(b);
    expect(squad.flanker).toBe(b);
    expect(squad.flankDue).toBe(false); // one at a time
    squad.flankOver(a); // not the flanker: nothing changes
    expect(squad.flanker).toBe(b);
    squad.flankOver(b);
    expect(squad.flanker).toBeNull();
    hold(squad, squadConfig.flankWaitSec - 0.5);
    expect(squad.flankDue).toBe(false);
    hold(squad, 1);
    expect(squad.flankDue).toBe(true);
  });

  it('Flank now (dev) makes one due at once; reset clears everything', () => {
    const squad = new SquadCoordinator();
    squad.forceFlank();
    expect(squad.flankDue).toBe(true);
    squad.assignFlank([{}], () => ({ cost: 0 }));
    squad.reset();
    expect(squad.flanker).toBeNull();
    expect(squad.heldSec).toBe(0);
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
