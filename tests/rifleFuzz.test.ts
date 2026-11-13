import { describe, expect, it } from 'vitest';
import { rifleConfigDefaults } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import { Rifle } from '../src/weapons/rifle';

// Random play: holding the trigger, tapping R, not being allowed to fire. Rounds must never appear from nowhere or vanish.
describe('rifle random play', () => {
  it('only shots remove rounds, and no magazine is ever over capacity', () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let game = 0; game < 20; game++) {
      const events = new EventBus<WeaponEvents>();
      let shots = 0;
      events.on('weapon:fired', () => shots++);
      const rifle = new Rifle(events);
      const start = rifle.magazines.totalRounds;
      let triggerHeld = false;
      for (let tick = 0; tick < 6000; tick++) {
        if (random() < 0.05) triggerHeld = !triggerHeld;
        rifle.update(1 / 60, { triggerHeld, reloadPressed: random() < 0.02, canFire: random() < 0.9 });
        // Rounds in the gun and pouch: what we started with, minus shots. Dropped empty magazines held 0, so nothing is lost.
        expect(rifle.magazines.totalRounds).toBe(start - shots);
        expect(rifle.magazines.loadedRounds).toBeLessThanOrEqual(rifleConfigDefaults.magazineRounds);
        expect(rifle.magazines.loadedRounds).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
