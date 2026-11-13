// Fixed-timestep maths, with no browser code so it can be tested.
// Why: game rules must run the same number of times per second on a 60 Hz and a 144 Hz screen.

export interface FixedStepResult {
  /** How many fixed updates to run this frame. */
  steps: number;
  /** Time left over, to carry into the next frame. Always less than one step. */
  accumulatorSec: number;
}

export function advanceFixedStep(
  accumulatorSec: number,
  frameSec: number,
  stepSec: number,
  maxFrameGapSec: number,
): FixedStepResult {
  const cappedFrameSec = Math.min(Math.max(frameSec, 0), maxFrameGapSec);
  let remainingSec = accumulatorSec + cappedFrameSec;
  let steps = 0;
  while (remainingSec >= stepSec) {
    remainingSec -= stepSec;
    steps += 1;
  }
  return { steps, accumulatorSec: remainingSec };
}
