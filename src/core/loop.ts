import { loopConfig } from '../config/loop';
import { advanceFixedStep } from './fixedStep';

const stepSec = 1 / loopConfig.updateRateHz;

// Runs update() at a fixed rate while the game is playing, and render() on every screen frame.
// render() receives alpha (0 to 1): how far we are between the last two updates, for smooth drawing.
export class Loop {
  private accumulatorSec = 0;
  private lastTimeMs = 0;
  // Kept while paused so the frozen picture does not jump back one update.
  private alpha = 1;

  constructor(
    private readonly update: (stepSec: number) => void,
    private readonly render: (alpha: number) => void,
    private readonly isPlaying: () => boolean,
  ) {}

  start(): void {
    this.lastTimeMs = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (timeMs: number): void => {
    const frameSec = (timeMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = timeMs;

    if (this.isPlaying()) {
      const result = advanceFixedStep(this.accumulatorSec, frameSec, stepSec, loopConfig.maxFrameGapSec);
      this.accumulatorSec = result.accumulatorSec;
      for (let i = 0; i < result.steps; i++) this.update(stepSec);
      this.alpha = this.accumulatorSec / stepSec;
    } else {
      // Paused: drop leftover time so resuming does not run a burst of catch-up updates.
      this.accumulatorSec = 0;
    }

    this.render(this.alpha);
    requestAnimationFrame(this.tick);
  };
}
