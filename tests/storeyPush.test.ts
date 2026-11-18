import { describe, expect, it } from 'vitest';
import { StoreyPush, type Climber } from '../src/squad/storeyPush';

// The storey push's rule (decision 277): when someone is sent up to Rook's floor, and who.

const tier = { storeyPush: 1, storeyPushAfterSec: 8, storeyPushMax: 1 };
const member = (yM: number, over: Partial<Climber> = {}) => ({ yM, canClimb: true, isClimbing: false, ...over });
/** Runs `seconds` of updates; returns who was sent first (or null). */
function run(push: StoreyPush, seconds: number, rookY: number | null, members: Climber[], t = tier, prefer?: (m: Climber) => boolean) {
  for (let i = 0; i < seconds * 10; i++) {
    const sent = push.update(0.1, rookY, members, t, 2, 6, prefer);
    if (sent) return sent;
  }
  return null;
}

describe('the storey push', () => {
  it('sends nobody while everyone is on Rook floor, or while the squad does not know where he is', () => {
    expect(run(new StoreyPush(), 30, 4.5, [member(4.5), member(5)])).toBeNull();
    expect(run(new StoreyPush(), 30, null, [member(0)])).toBeNull();
    expect(run(new StoreyPush(), 30, 4.5, [member(0)], { ...tier, storeyPush: 0 })).toBeNull(); // Cautious
  });

  it('sends one after the tier time of Rook being on another floor, not before', () => {
    const below = member(0);
    const push = new StoreyPush();
    expect(run(push, 7.5, 4.5, [below])).toBeNull();
    expect(run(push, 1, 4.5, [below])).toBe(below);
  });

  it('the time starts over when he comes down, or when nobody is left elsewhere', () => {
    const below = member(0);
    const push = new StoreyPush();
    run(push, 7, 4.5, [below]);
    run(push, 1, 0, [below]); // he came down: same floor
    expect(run(push, 7, 4.5, [below])).toBeNull();
  });

  it('waits the gap before the next one, and never more at once than the tier allows', () => {
    const a = member(0);
    const b = member(0);
    const push = new StoreyPush();
    expect(run(push, 10, 4.5, [a, b])).toBe(a);
    a.isClimbing = true;
    expect(run(push, 20, 4.5, [a, b])).toBeNull(); // the tier allows one at a time
    expect(run(push, 20, 4.5, [a, b], { ...tier, storeyPushMax: 2 })).toBe(b);
  });

  it('skips those who cannot go and takes the preferred one first', () => {
    const busy = member(0, { canClimb: false });
    const leader = member(0);
    const trooper = member(0);
    expect(run(new StoreyPush(), 10, 4.5, [busy, leader, trooper], tier, (m) => m !== leader)).toBe(trooper);
    expect(run(new StoreyPush(), 10, 4.5, [busy, leader], tier, (m) => m !== leader)).toBe(leader); // nobody preferred: the leader goes
    expect(run(new StoreyPush(), 10, 4.5, [busy])).toBeNull();
  });

  it('works downward too: Rook on the floor and an enemy on the ring', () => {
    const above = member(4.5);
    expect(run(new StoreyPush(), 10, 0, [above])).toBe(above);
  });
});
