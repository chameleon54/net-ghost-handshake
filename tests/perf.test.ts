import { describe, expect, it } from 'vitest';
import { formatPerf, PerfMeter } from '../src/debug/perf';

describe('the performance readout (4.13b)', () => {
  it('reports nothing until a full second has passed, then the averages and worsts of that second', () => {
    const perf = new PerfMeter();
    // 50 frames of 10 ms and 25 of 20 ms: 1 s in all, 75 frames.
    for (let i = 0; i < 75; i++) {
      expect(perf.report).toBeNull();
      perf.addAi(i === 10 ? 3 : 1); // one frame with a slow AI step
      if (i === 20) perf.addAi(0.5); // a frame with two update steps: 1 + 0.5
      perf.addRender(2);
      perf.countRay();
      perf.countRay();
      if (i % 3 === 0) perf.countRoute();
      perf.frame(i < 50 ? 10 : 20, 40, 5000);
    }
    const report = perf.report!;
    expect(report.fps).toBeCloseTo(75);
    expect(report.frameMsAvg).toBeCloseTo(1000 / 75);
    expect(report.frameMsWorst).toBe(20);
    expect(report.aiMsAvg).toBeCloseTo((75 + 2 + 0.5) / 75);
    expect(report.aiMsWorst).toBe(3);
    expect(report.renderMsAvg).toBeCloseTo(2);
    expect(report.raysPerSec).toBeCloseTo(150);
    expect(report.routesPerSec).toBeCloseTo(25);
    expect(report.drawCalls).toBe(40);
    expect(report.triangles).toBe(5000);
  });

  it('starts the next second from zero', () => {
    const perf = new PerfMeter();
    perf.addAi(5);
    perf.frame(1000, 1, 1); // one slow frame closes the first second
    perf.addAi(1);
    for (let i = 0; i < 100; i++) perf.frame(10, 1, 1);
    expect(perf.report!.fps).toBeCloseTo(100);
    expect(perf.report!.frameMsWorst).toBe(10);
    expect(perf.report!.aiMsWorst).toBe(1);
  });

  it('shows a waiting line before the first second, three lines after', () => {
    expect(formatPerf(null)).toHaveLength(1);
    const perf = new PerfMeter();
    perf.frame(1000, 1, 1);
    expect(formatPerf(perf.report)).toHaveLength(3);
  });
});
