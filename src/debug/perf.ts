// The performance readout (4.13b, dev server only). It collects, over one second at a time, how long frames take, how
// much of that the enemy AI and the drawing take on the CPU, and how many rays and route searches the game asks for.
// Rays and routes are counted, not timed: the browser's clock is too coarse (about 0.1 ms) to time one ray, so their
// cost per call comes from `npm run bench`, and count x cost gives their share.

import type { FrameCost } from './eventLog';

export interface PerfReport {
  fps: number;
  frameMsAvg: number;
  frameMsWorst: number;
  /** The AI's time per frame: the squad's plans, every stand-in's update and sight check, the exposure meter. */
  aiMsAvg: number;
  aiMsWorst: number;
  /** The CPU time spent handing the frame to the graphics card (both render calls). */
  renderMsAvg: number;
  raysPerSec: number;
  routesPerSec: number;
  /** As of the last frame of the second. */
  drawCalls: number;
  triangles: number;
}

const windowSec = 1;
const msPerSec = 1000;

export class PerfMeter {
  /** The last full second, or null until one has passed. */
  report: PerfReport | null = null;
  /** What the frame just closed by `frame()` cost (for the debug log's slow-frame lines). Reused. */
  readonly lastFrame: FrameCost = { aiMs: 0, rays: 0, routes: 0 };

  private elapsedMs = 0;
  private frames = 0;
  private frameMsWorst = 0;
  private aiMsSum = 0;
  private aiMsThisFrame = 0;
  private aiMsWorst = 0;
  private renderMsSum = 0;
  private rays = 0;
  private routes = 0;
  private raysThisFrame = 0;
  private routesThisFrame = 0;

  /** The AI's time in one update step (a frame can hold none, one or several). */
  addAi(ms: number): void {
    this.aiMsSum += ms;
    this.aiMsThisFrame += ms;
  }

  addRender(ms: number): void {
    this.renderMsSum += ms;
  }

  countRay(): void {
    this.rays++;
    this.raysThisFrame++;
  }

  countRoute(): void {
    this.routes++;
    this.routesThisFrame++;
  }

  /**
   * Called once per screen frame with the time since the last one, and the draw calls and triangles of the frame just
   * drawn. Closes the second when it is full.
   */
  frame(frameMs: number, drawCalls: number, triangles: number): void {
    this.frames++;
    this.elapsedMs += frameMs;
    this.frameMsWorst = Math.max(this.frameMsWorst, frameMs);
    this.aiMsWorst = Math.max(this.aiMsWorst, this.aiMsThisFrame);
    this.lastFrame.aiMs = this.aiMsThisFrame;
    this.lastFrame.rays = this.raysThisFrame;
    this.lastFrame.routes = this.routesThisFrame;
    this.aiMsThisFrame = 0;
    this.raysThisFrame = 0;
    this.routesThisFrame = 0;
    if (this.elapsedMs < windowSec * msPerSec) return;

    const seconds = this.elapsedMs / msPerSec;
    this.report = {
      fps: this.frames / seconds,
      frameMsAvg: this.elapsedMs / this.frames,
      frameMsWorst: this.frameMsWorst,
      aiMsAvg: this.aiMsSum / this.frames,
      aiMsWorst: this.aiMsWorst,
      renderMsAvg: this.renderMsSum / this.frames,
      raysPerSec: this.rays / seconds,
      routesPerSec: this.routes / seconds,
      drawCalls,
      triangles,
    };
    this.elapsedMs = 0;
    this.frames = 0;
    this.frameMsWorst = 0;
    this.aiMsSum = 0;
    this.aiMsWorst = 0;
    this.renderMsSum = 0;
    this.rays = 0;
    this.routes = 0;
  }
}

/** The readout's lines. */
export function formatPerf(report: PerfReport | null): string[] {
  if (!report) return ['perf      measuring (one second)...'];
  const r = report;
  return [
    `perf      ${r.fps.toFixed(0)} fps, frame ${r.frameMsAvg.toFixed(1)} ms avg, ${r.frameMsWorst.toFixed(1)} ms worst`,
    `  cpu     AI ${r.aiMsAvg.toFixed(2)} ms avg (${r.aiMsWorst.toFixed(2)} worst), drawing ${r.renderMsAvg.toFixed(2)} ms; the rest is the graphics card and the browser`,
    `  calls   ${r.raysPerSec.toFixed(0)} rays/s (all; Rook's own are a few per frame),${r.routesPerSec.toFixed(0)} routes/s, ${r.drawCalls} draw calls, ${r.triangles} triangles`,
  ];
}
