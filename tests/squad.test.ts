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

describe('SquadCoordinator roles (4.8)', () => {
  it('the flank job goes to a preferred one (a flanker) even if another plan is cheaper; to the others only if none can', () => {
    const squad = new SquadCoordinator();
    const [flanker, trooper] = [{ flanker: true }, { flanker: false }];
    squad.forceFlank();
    const job = squad.assignFlank([trooper, flanker], (m) => ({ cost: m.flanker ? 9 : 1 }), (m) => m.flanker);
    expect(job?.member).toBe(flanker);
    squad.reset();
    squad.forceFlank();
    const fallback = squad.assignFlank([trooper, flanker], (m) => (m.flanker ? null : { cost: 1 }), (m) => m.flanker);
    expect(fallback?.member).toBe(trooper);
  });

  it('with the leader down: no flank starts, fewer firing slots, for the disorder time; then back to normal', () => {
    const squad = new SquadCoordinator();
    squad.forceFlank();
    squad.leaderDown();
    expect(squad.disorganised).toBe(true);
    expect(squad.flankDue).toBe(false);
    const members = Array.from({ length: 4 }, () => ({}));
    const granted = members.filter((m) => squad.requestSlot(m)).length;
    expect(granted).toBe(Math.min(squadConfig.disorderSlots, squadConfig.firingSlots));
    for (const m of members) squad.releaseSlot(m);
    squad.update(squadConfig.disorderSec + 0.01);
    expect(squad.disorganised).toBe(false);
    expect(members.filter((m) => squad.requestSlot(m)).length).toBe(squadConfig.firingSlots);
  });
});

describe('SquadCoordinator suppress and advance (4.9)', () => {
  const rook = { x: 0, z: 0 };
  const due = () => {
    const squad = new SquadCoordinator();
    squad.update(squadConfig.advanceEverySec + 0.1, rook, true);
    return squad;
  };
  const heavy = { heavy: true };
  const [a, b] = [{ heavy: false }, { heavy: false }];
  const isHeavy = (m: { heavy: boolean }) => m.heavy;

  it('a play is due only while Rook hides where the squad knows he is, after the wait, and not in disorder', () => {
    const squad = new SquadCoordinator();
    squad.update(1, rook, true);
    expect(squad.playDue).toBe(false); // the wait
    expect(due().playDue).toBe(true);
    const seen = new SquadCoordinator();
    seen.update(squadConfig.advanceEverySec + 0.1, rook, false);
    expect(seen.playDue).toBe(false);
    const lost = new SquadCoordinator();
    lost.update(squadConfig.advanceEverySec + 0.1, null, true);
    expect(lost.playDue).toBe(false);
    const leaderless = due();
    leaderless.leaderDown();
    expect(leaderless.playDue).toBe(false);
  });

  it('the cheapest mover moves up, covered by someone else (the heavy first); nothing without covering fire', () => {
    const squad = due();
    const play = squad.assignAdvance([a, heavy], (m) => ({ cost: m === heavy ? 1 : 2 }), [a, b, heavy], isHeavy);
    expect(play?.advancer.member).toBe(heavy);
    expect(play?.suppressor).toBe(a); // not the mover, even though it is the heavy
    expect(squad.playDue).toBe(false);

    const alone = due();
    expect(alone.assignAdvance([a], () => ({ cost: 1 }), [a], isHeavy)).toBeNull();
    expect(alone.playFailure).toBe('nobody to give covering fire');
    expect(alone.playDue).toBe(false); // tries again later
    const nowhere = due();
    expect(nowhere.assignAdvance([a], () => null, [b, heavy], isHeavy)).toBeNull();
    expect(nowhere.playFailure).toBe('no closer cover to move up to');
  });

  it('the suppressor keeps on while the move is on, and stops a moment after it is over', () => {
    const squad = due();
    squad.assignAdvance([a], () => ({ cost: 1 }), [b, heavy], isHeavy);
    expect(squad.keepSuppressing(heavy)).toBe(true);
    expect(squad.keepSuppressing(b)).toBe(false);
    squad.advanceOver(a);
    expect(squad.keepSuppressing(heavy)).toBe(true); // the grace after the move
    squad.update(squadConfig.suppressAfterMoveSec + 0.01, rook, true);
    expect(squad.keepSuppressing(heavy)).toBe(false);
    squad.suppressOver(heavy);
    expect(squad.suppressor).toBeNull();
  });

  it('a flank gets covering fire when someone is free, for as long as the flank is on', () => {
    const squad = new SquadCoordinator();
    squad.forceFlank();
    squad.assignFlank([a], () => ({ cost: 1 }));
    expect(squad.assignCover([b, heavy], isHeavy)).toBe(heavy);
    expect(squad.keepSuppressing(heavy)).toBe(true);
    expect(squad.assignCover([b], isHeavy)).toBeNull(); // one suppressor at a time
    squad.flankOver(a);
    squad.update(squadConfig.suppressAfterMoveSec + 0.01, rook, true);
    expect(squad.keepSuppressing(heavy)).toBe(false);
  });
});

describe("SquadCoordinator hearing Rook's gun (4.10)", () => {
  const step = (squad: SquadCoordinator, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) squad.update(1 / 60, { x: 0, z: 0 }, false);
  };

  it('pushes once, after the reaction delay, while the window is open', () => {
    const squad = new SquadCoordinator();
    squad.heard('dry');
    expect(squad.pushDue).toBeNull();
    step(squad, squadConfig.pushReactionSec - 0.1);
    squad.heard('dry'); // another click: the same window, the delay goes on
    expect(squad.pushDue).toBeNull();
    step(squad, 0.2);
    expect(squad.pushDue).toBe('dry');
    squad.pushStarted();
    expect(squad.pushDue).toBeNull(); // one push per window
    squad.heard('dry');
    expect(squad.pushDue).toBeNull();
  });

  it('no push if he stops being vulnerable before the delay is over (he fired, reloaded, cleared the jam)', () => {
    const squad = new SquadCoordinator();
    squad.heard('jam');
    step(squad, squadConfig.pushReactionSec / 2);
    squad.closeWindow('dry'); // a different window: nothing changes
    squad.closeWindow('jam');
    step(squad, squadConfig.pushReactionSec);
    expect(squad.pushDue).toBeNull();
    expect(squad.heardKind).toBeNull();
  });

  it('a new kind of sound opens a new window (a reload after the dry clicks); a window ends after its limit', () => {
    const squad = new SquadCoordinator();
    squad.heard('dry');
    step(squad, squadConfig.pushReactionSec + 0.1);
    squad.pushStarted();
    squad.heard('reload');
    step(squad, squadConfig.pushReactionSec + 0.1);
    expect(squad.pushDue).toBe('reload');
    step(squad, squadConfig.pushMaxWindowSec);
    expect(squad.heardKind).toBeNull();
  });

  it('no push while the squad is disorganised', () => {
    const squad = new SquadCoordinator();
    squad.leaderDown();
    squad.heard('dry');
    step(squad, squadConfig.pushReactionSec + 0.1);
    expect(squad.pushDue).toBeNull();
  });

  it('a play with more than one mover: the covering fire goes on until the last one has arrived', () => {
    const squad = new SquadCoordinator();
    const [first, second, cover] = [{}, {}, {}];
    squad.assignAdvance([first], () => ({ cost: 1 }), [cover], () => false);
    squad.addAdvancer(second);
    expect(squad.advancers).toHaveLength(2);
    squad.advanceOver(first);
    step(squad, squadConfig.suppressAfterMoveSec + 0.1);
    expect(squad.keepSuppressing(cover)).toBe(true); // the second is still moving
    squad.advanceOver(second);
    step(squad, squadConfig.suppressAfterMoveSec + 0.1);
    expect(squad.keepSuppressing(cover)).toBe(false);
  });
});

describe('SquadCoordinator repositioning and the heavy (decision 237)', () => {
  it('one reposition at a time; its covering fire goes on while it moves and a moment after', () => {
    const squad = new SquadCoordinator();
    const [a, b, cover] = [{}, {}, {}];
    expect(squad.assignReposition(a)).toBe(true);
    expect(squad.assignReposition(b)).toBe(false);
    expect(squad.assignCover([cover], () => false)).toBe(cover);
    expect(squad.keepSuppressing(cover)).toBe(true);
    squad.repositionOver(a);
    expect(squad.repositioner).toBeNull();
    squad.update(squadConfig.suppressAfterMoveSec + 0.01);
    expect(squad.keepSuppressing(cover)).toBe(false);
    expect(squad.assignReposition(b)).toBe(true);
  });

  it('a mover that fires on the move (the heavy) needs nobody to cover it', () => {
    const squad = new SquadCoordinator();
    const heavy = {};
    const play = squad.assignAdvance([heavy], () => ({ cost: 1 }), [], () => false, (m) => m === heavy);
    expect(play?.advancer.member).toBe(heavy);
    expect(play?.suppressor).toBeNull();
    const trooper = {};
    expect(new SquadCoordinator().assignAdvance([trooper], () => ({ cost: 1 }), [], () => false, (m) => m === heavy)).toBeNull();
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
