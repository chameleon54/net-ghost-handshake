import { loopConfig } from '../config/loop';
import { advanceFixedStep } from './fixedStep';

const stepSec = 1 / loopConfig.updateRateHz;

// Runs update() at a fixed rate while the game is playing, and render() on every screen frame.
// shortcut: render() gets no interpolation between updates, so motion can look slightly steppy on
// screens faster than 60 Hz; add interpolation when player movement exists (milestone 1.2).
export class Loop {
  private accumulatorSec = 0;
  private lastTimeMs = 0;

  constructor(
    private readonly update: (stepSec: number) => void,
    private readonly render: () => void,
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
    } else {
      // Paused: drop leftover time so resuming does not run a burst of catch-up updates.
      this.accumulatorSec = 0;
    }

    this.render();
    requestAnimationFrame(this.tick);
  };
}
