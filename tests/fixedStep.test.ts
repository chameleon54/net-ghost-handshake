import { describe, expect, it } from 'vitest';
import { advanceFixedStep } from '../src/core/fixedStep';

// Step 0.25 s and gaps in quarters are exact in binary, so the maths below has no rounding noise.
const stepSec = 0.25;
const maxGapSec = 1;

describe('advanceFixedStep', () => {
  it('runs no update when less than one step has passed, and keeps the time', () => {
    expect(advanceFixedStep(0, 0.125, stepSec, maxGapSec)).toEqual({ steps: 0, accumulatorSec: 0.125 });
  });

  it('runs several updates when several steps have passed', () => {
    expect(advanceFixedStep(0, 0.75, stepSec, maxGapSec)).toEqual({ steps: 3, accumulatorSec: 0 });
  });

  it('carries leftover time into the next frame', () => {
    const first = advanceFixedStep(0, 0.375, stepSec, maxGapSec);
    expect(first).toEqual({ steps: 1, accumulatorSec: 0.125 });
    expect(advanceFixedStep(first.accumulatorSec, 0.125, stepSec, maxGapSec)).toEqual({ steps: 1, accumulatorSec: 0 });
  });

  it('cuts a huge frame gap to the maximum instead of catching up', () => {
    expect(advanceFixedStep(0, 60, stepSec, maxGapSec).steps).toBe(4);
  });

  it('ignores negative frame times', () => {
    expect(advanceFixedStep(0.125, -5, stepSec, maxGapSec)).toEqual({ steps: 0, accumulatorSec: 0.125 });
  });
});
