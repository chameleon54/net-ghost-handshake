import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { playerConfig } from '../src/config/player';
import { Input } from '../src/core/input';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { Player } from '../src/player/player';

// Random play: random keys and mouse movement for a long time, checking the player is never somewhere impossible.
// A small seeded random generator keeps every run identical, so a failure can be reproduced.
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const { collision } = buildGreybox(greyboxRoom);
const dt = 1 / 60;
const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyC', 'Space', 'KeyQ', 'KeyE'];
const heights = { standing: playerConfig.heightM, crouching: playerConfig.crouchHeightM, sliding: playerConfig.slideHeightM };

/** Puts the player at a random spot where a standing capsule fits, on the floor. */
function respawn(player: Player, random: () => number): void {
  for (let attempt = 0; attempt < 50; attempt++) {
    const spot = new Vector3((random() - 0.5) * 14, 0, (random() - 0.5) * 10);
    if (!collision.overlapsCapsule(spot, playerConfig.capsuleRadiusM, playerConfig.heightM, 0.05)) {
      player.position.copy(spot);
      return;
    }
  }
}

describe('random play never puts the player somewhere impossible', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}`, () => {
      const random = makeRandom(seed);
      const input = new Input();
      input.enabled = true;
      const player = new Player(collision);
      const feet = new Vector3();
      let climbs = 0;
      let wasClimbing = false;

      for (let step = 0; step < 18000; step++) {
        // Every few seconds, jump to a random free spot, so the whole room gets visited and many ledges are met.
        if (step % 240 === 0) respawn(player, random);

        // Change a few keys now and then, and turn the view at random.
        if (random() < 0.08) {
          const key = keys[Math.floor(random() * keys.length)];
          if (input.isKeyDown(key)) input.keyUp(key);
          else input.keyDown(key);
        }
        // Walk forward most of the time and tap Space often, which is what climbing needs.
        if (random() < 0.5) input.keyDown('KeyW');
        if (random() < 0.12) {
          input.keyDown('Space');
          input.keyUp('Space');
        }
        if (random() < 0.3) input.addMouseMove((random() - 0.5) * 400, (random() - 0.5) * 20);
        player.look(input);
        player.fixedUpdate(dt, input);

        feet.copy(player.position);
        const where = `step ${step} at ${feet.x.toFixed(2)}, ${feet.y.toFixed(2)}, ${feet.z.toFixed(2)} (${player.stance.stance})`;
        expect(Number.isFinite(feet.x + feet.y + feet.z), where).toBe(true);
        expect(feet.y, `below the floor: ${where}`).toBeGreaterThanOrEqual(0);
        expect(feet.y, `too high: ${where}`).toBeLessThan(2.0);
        expect(Math.abs(feet.x), `outside the room: ${where}`).toBeLessThan(8);
        expect(Math.abs(feet.z), `outside the room: ${where}`).toBeLessThan(6);

        if (player.mantle.active) {
          if (!wasClimbing) climbs++;
        } else {
          // Whenever the scripted climb is not running, the body must be clear of every wall and prop.
          const inside = collision.overlapsCapsule(feet, playerConfig.capsuleRadiusM, heights[player.stance.stance], 0.05);
          expect(inside, `inside geometry: ${where}`).toBe(false);
        }
        wasClimbing = player.mantle.active;
      }
      // The run must actually have climbed a good number of times, or it proves little.
      console.log(`seed ${seed}: ${climbs} climbs or vaults`);
      expect(climbs).toBeGreaterThan(10);
    });
  }
});
