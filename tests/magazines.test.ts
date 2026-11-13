import { describe, expect, it } from 'vitest';
import { Magazines } from '../src/weapons/magazines';
import { magazineFeel } from '../src/weapons/magazineFeel';

const fire = (m: Magazines, shots: number) => {
  for (let i = 0; i < shots; i++) m.takeRound();
};

describe('Magazines', () => {
  it('starts ready: a full magazine and a round in the chamber, the rest spare', () => {
    const m = new Magazines(30, 4);
    expect(m.loadedRounds).toBe(31);
    expect(m.spareCount).toBe(3);
    expect(m.totalRounds).toBe(121);
  });

  it('each shot uses one round, feeding the next into the chamber, until the very last', () => {
    const m = new Magazines(30, 1);
    fire(m, 30);
    expect(m.loadedRounds).toBe(1);
    expect(m.chambered).toBe(true);
    expect(m.takeRound()).toBe(true);
    expect(m.loadedRounds).toBe(0);
    expect(m.chambered).toBe(false);
    expect(m.takeRound()).toBe(false);
  });

  it('a reload with rounds left keeps the chambered round and the partly used magazine', () => {
    const m = new Magazines(30, 3);
    fire(m, 10); // 21 ready: 20 in the magazine and one in the chamber
    expect(m.reload()).toBe(true);
    expect(m.loadedRounds).toBe(31); // a full magazine plus the chambered round
    expect(m.spareCount).toBe(2); // one full, plus the 20-round one
    expect(m.totalRounds).toBe(31 + 30 + 20);
  });

  it('a reload with an empty gun racks: it chambers a round from the new magazine, and drops the empty one', () => {
    const m = new Magazines(30, 2);
    fire(m, 31);
    expect(m.loadedRounds).toBe(0);
    expect(m.reload()).toBe(true);
    expect(m.loadedRounds).toBe(30);
    expect(m.chambered).toBe(true);
    expect(m.spareCount).toBe(0);
    expect(m.totalRounds).toBe(30);
  });

  it('loads the fullest spare', () => {
    const m = new Magazines(30, 3);
    fire(m, 20); // 11 ready: 10 + 1
    m.reload(); // loads a full one, the 10-round one goes in the pouch
    fire(m, 11); // 20 ready: 19 + 1
    m.reload(); // fullest spare is the other full one
    expect(m.loadedRounds).toBe(31);
    expect(m.spareCount).toBe(2);
  });

  it('does not reload a full gun, but does once a round has been fired (the spare is then fuller)', () => {
    const m = new Magazines(30, 2);
    expect(m.canReload).toBe(false); // full magazine, full spare
    fire(m, 1);
    expect(m.canReload).toBe(true); // 29 in the magazine against a spare of 30
  });

  it('does not reload when the spare has less than the magazine in the gun', () => {
    const m = new Magazines(30, 3);
    fire(m, 20);
    m.reload(); // now a 10-round spare is in the pouch
    fire(m, 2); // 28 in the magazine; the spares are a full one (30) and one with 10: a reload is worth it
    m.reload(); // now the spares are the 10-round one and the 28-round one
    fire(m, 2); // 28 in the magazine again
    expect(m.canReload).toBe(false); // the fullest spare (28) is no better than the magazine in the gun
  });

  it('cannot reload with nothing in the pouch', () => {
    const m = new Magazines(30, 1);
    fire(m, 5);
    expect(m.canReload).toBe(false);
    expect(m.reload()).toBe(false);
  });

  it('never creates or loses a round, whatever is done', () => {
    let seed = 2024;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let game = 0; game < 50; game++) {
      const m = new Magazines(30, 4);
      let total = m.totalRounds;
      for (let i = 0; i < 400; i++) {
        if (random() < 0.7) {
          if (m.takeRound()) total -= 1;
        } else {
          m.reload();
        }
        expect(m.totalRounds).toBe(total);
        expect(m.magRounds).toBeLessThanOrEqual(30);
        expect(m.magRounds).toBeGreaterThanOrEqual(0);
        if (m.magRounds > 0) expect(m.chambered).toBe(true); // a round is always chambered while any remain
      }
    }
  });
});

describe('magazineFeel', () => {
  const feelAfter = (shots: number) => {
    const m = new Magazines(30, 1);
    fire(m, shots);
    return magazineFeel(m);
  };

  it('gives a rough word, never a number', () => {
    expect(feelAfter(0)).toBe('full');
    expect(feelAfter(1)).toBe('full'); // 30 left: the magazine's worth
    expect(feelAfter(2)).toBe('mostlyFull');
    expect(feelAfter(10)).toBe('mostlyFull');
    expect(feelAfter(15)).toBe('aboutHalf');
    expect(feelAfter(25)).toBe('nearlyEmpty');
    expect(feelAfter(30)).toBe('nearlyEmpty'); // one round still chambered
    expect(feelAfter(31)).toBe('empty');
  });
});
