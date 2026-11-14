import { describe, expect, it } from 'vitest';
import { exposureConfig } from '../src/config/exposure';
import { Exposure, hitChance, missOffsetM, type Glimpse } from '../src/player/exposure';

const glimpse = (overrides: Partial<Glimpse> = {}): Glimpse => ({
  visibleShare: 1,
  distanceM: 5,
  fromSide: false,
  inViewOfLastSpot: true,
  ...overrides,
});

/** The meter after `seconds` of the same glimpses, from `start`. */
function after(seconds: number, glimpses: Glimpse[], { start = 0, crouched = false } = {}): number {
  const meter = new Exposure();
  meter.value = start;
  const dtSec = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dtSec); i++) meter.update(dtSec, glimpses, crouched);
  return meter.value;
}

describe('the exposure meter (4.5)', () => {
  it('fills at its rate while an enemy sees all of Rook up close, and stops at 1', () => {
    expect(after(1, [glimpse()])).toBeCloseTo(exposureConfig.fillPerSec, 5);
    expect(after(10, [glimpse()])).toBe(1);
  });

  it('fills slower when only part of him shows (a lean shows only his head)', () => {
    expect(after(1, [glimpse({ visibleShare: 1 / 3 })])).toBeCloseTo(exposureConfig.fillPerSec / 3, 5);
  });

  it('fills slower crouched and far away, faster from beside or behind', () => {
    const rate = exposureConfig.fillPerSec;
    expect(after(1, [glimpse()], { crouched: true })).toBeCloseTo(rate * exposureConfig.crouchFillShare, 5);
    expect(after(1, [glimpse({ distanceM: exposureConfig.farRangeM + 5 })])).toBeCloseTo(rate * exposureConfig.farFillShare, 5);
    const midM = (exposureConfig.fullFillRangeM + exposureConfig.farRangeM) / 2;
    expect(after(1, [glimpse({ distanceM: midM })])).toBeCloseTo(rate * (1 + exposureConfig.farFillShare) / 2, 5);
    expect(after(1, [glimpse({ fromSide: true })])).toBeCloseTo(rate * exposureConfig.sideFillScale, 5);
  });

  it('with several enemies the fastest counts, not their sum', () => {
    expect(after(1, [glimpse(), glimpse(), glimpse({ visibleShare: 1 / 3 })])).toBeCloseTo(after(1, [glimpse()]), 5);
  });

  it('holds while no enemy sees him but he is still in view of where one saw him from (it ducked into cover)', () => {
    expect(after(exposureConfig.holdMaxSec - 0.5, [glimpse({ visibleShare: 0 })], { start: 0.8 })).toBe(0.8);
  });

  it('drains once he is behind cover, and after the hold limit even if he stays in view', () => {
    expect(after(0.5, [glimpse({ visibleShare: 0, inViewOfLastSpot: false })], { start: 0.8 })).toBeCloseTo(0.8 - exposureConfig.drainPerSec * 0.5, 5);
    expect(after(exposureConfig.holdMaxSec + 0.5, [glimpse({ visibleShare: 0 })], { start: 0.8 })).toBeCloseTo(0.8 - exposureConfig.drainPerSec * 0.5, 1);
    expect(after(1, [], { start: 0.3 })).toBe(0); // no awake enemy at all
  });

  it('reset puts it back to 0', () => {
    const meter = new Exposure();
    meter.update(1, [glimpse()], false);
    meter.reset();
    expect(meter.value).toBe(0);
  });
});

describe('hit chance and misses from exposure (4.5)', () => {
  it('no hits below the start exposure, then a straight rise to the most at full', () => {
    expect(hitChance(0, false)).toBe(0);
    expect(hitChance(exposureConfig.hitStartExposure, false)).toBe(0);
    expect(hitChance(1, false)).toBeCloseTo(exposureConfig.maxHitChance, 5);
    const halfway = (exposureConfig.hitStartExposure + 1) / 2;
    expect(hitChance(halfway, false)).toBeCloseTo(exposureConfig.maxHitChance / 2, 5);
  });

  it('sprinting or sliding lowers it', () => {
    expect(hitChance(1, true)).toBeCloseTo(exposureConfig.maxHitChance * exposureConfig.movingHitShare, 5);
  });

  it('misses pass far at exposure 0 and close at full', () => {
    expect(missOffsetM(0)).toBeCloseTo(exposureConfig.missFarOffsetM, 5);
    expect(missOffsetM(1)).toBeCloseTo(exposureConfig.missNearOffsetM, 5);
  });
});
