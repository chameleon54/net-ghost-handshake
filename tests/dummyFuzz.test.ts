import { describe, expect, it } from 'vitest';
import { Dummy } from '../src/enemies/dummy';

// Random play: hits of every kind at random moments. Health stays in range, a headshot on a standing dummy always kills,
// and a dummy that is not standing never takes damage.
describe('dummy random play', () => {
  it('keeps its rules whatever happens', () => {
    let seed = 777;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const dummy = new Dummy(0, 0);
    for (let tick = 0; tick < 20000; tick++) {
      if (random() < 0.2) {
        const zone = random() < 0.3 ? 'head' : 'body';
        const wasStanding = dummy.hittable;
        const before = dummy.health.current;
        const killed = dummy.hit(zone, random() * 40);
        if (zone === 'head' && wasStanding) expect(killed).toBe(true);
        if (!wasStanding) expect(dummy.health.current).toBe(before);
      }
      dummy.update(1 / 60);
      expect(dummy.health.current).toBeGreaterThanOrEqual(0);
      expect(dummy.state === 'standing').toBe(!dummy.health.dead);
    }
  });
});
