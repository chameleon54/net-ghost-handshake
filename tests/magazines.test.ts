import { describe, expect, it } from 'vitest';
import { Magazines } from '../src/weapons/magazines';

describe('Magazines', () => {
  it('starts with one loaded and the rest spare, all full', () => {
    const m = new Magazines(30, 4);
    expect(m.loadedRounds).toBe(30);
    expect(m.spareCount).toBe(3);
    expect(m.totalRounds).toBe(120);
  });

  it('a reload loads the fullest spare and keeps the partly used one', () => {
    const m = new Magazines(30, 3);
    for (let i = 0; i < 10; i++) m.takeRound(); // 20 left
    expect(m.reload()).toBe(true);
    expect(m.loadedRounds).toBe(30);
    expect(m.spareCount).toBe(2); // one full, plus the 20-round one
    for (let i = 0; i < 30; i++) m.takeRound(); // empty
    m.reload(); // takes the other full one
    expect(m.loadedRounds).toBe(30);
    for (let i = 0; i < 5; i++) m.takeRound(); // 25 left
    m.reload(); // the fullest spare has 20: not better than 25, so nothing changes
    expect(m.loadedRounds).toBe(25);
    expect(m.totalRounds).toBe(45);
  });

  it('drops an empty magazine instead of keeping it', () => {
    const m = new Magazines(30, 2);
    for (let i = 0; i < 30; i++) m.takeRound();
    expect(m.takeRound()).toBe(false);
    m.reload();
    expect(m.spareCount).toBe(0);
    expect(m.totalRounds).toBe(30);
  });

  it('cannot reload with nothing better in the pouch', () => {
    const m = new Magazines(30, 1);
    expect(m.canReload).toBe(false);
    expect(m.reload()).toBe(false);
  });

  it('a full gun does not swap for an equally full spare', () => {
    expect(new Magazines(30, 2).canReload).toBe(false);
  });
});
