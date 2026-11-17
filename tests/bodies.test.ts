import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { bodyInLine, keepApart } from '../src/enemies/bodies';

describe('keeping apart (4.16)', () => {
  const body = (x: number, z: number, fixed: boolean) => ({ feet: new Vector3(x, 0, z), fixed });

  it('a moving body steps aside from one holding its spot, by the whole overlap', () => {
    const holder = body(0, 0, true);
    const mover = body(0.2, 0, false);
    const moved: (typeof holder)[] = [];
    keepApart([holder, mover], 0.6, moved);
    expect(holder.feet.toArray()).toEqual([0, 0, 0]);
    expect(mover.feet.x).toBeCloseTo(0.6, 9);
    expect(moved).toEqual([mover]);
  });

  it('two moving bodies share the overlap; two holding theirs stay; touching is fine', () => {
    const a = body(0, 0, false);
    const b = body(0.4, 0, false);
    const moved: (typeof a)[] = [];
    keepApart([a, b], 0.6, moved);
    expect(a.feet.x).toBeCloseTo(-0.1, 9);
    expect(b.feet.x).toBeCloseTo(0.5, 9);
    const c = body(0, 0, true);
    const d = body(0.3, 0, true);
    keepApart([c, d], 0.6, moved);
    expect(d.feet.x).toBe(0.3); // a moment's brush during a side peek: left alone
    const e = body(0, 0, false);
    const f = body(0.6, 0, false); // exactly shoulder to shoulder
    keepApart([e, f], 0.6, moved);
    expect(moved).toHaveLength(0);
  });

  it('two bodies exactly on top of each other are parted', () => {
    const a = body(1, 1, false);
    const b = body(1, 1, false);
    keepApart([a, b], 0.6, []);
    expect(a.feet.distanceTo(b.feet)).toBeCloseTo(0.6, 9);
  });
});

describe('a body in the line of fire (4.16)', () => {
  const from = new Vector3(0, 1.4, 0);
  const to = new Vector3(10, 1.4, 0);

  it('counts a body on the line between shooter and target, within reach', () => {
    expect(bodyInLine(from, to, 5, 0.3, 1.8, 0.4)).toBe(true);
    expect(bodyInLine(from, to, 5, 0.5, 1.8, 0.4)).toBe(false); // beside the line
  });

  it('not one behind the shooter or behind the target, nor one the round passes over', () => {
    expect(bodyInLine(from, to, -1, 0, 1.8, 0.4)).toBe(false);
    expect(bodyInLine(from, to, 11, 0, 1.8, 0.4)).toBe(false);
    expect(bodyInLine(from, to, 5, 0, 1.0, 0.4)).toBe(false); // crouched below a round at 1.4 m
  });
});
