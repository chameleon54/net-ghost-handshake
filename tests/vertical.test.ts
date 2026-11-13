import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { playerConfig } from '../src/config/player';
import { Input } from '../src/core/input';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { Player } from '../src/player/player';

const { collision } = buildGreybox(greyboxRoom);
const r = playerConfig.capsuleRadiusM;
const dt = 1 / 60;

function newPlayer(x: number, y: number, z: number): { player: Player; input: Input } {
  const input = new Input();
  input.enabled = true;
  const player = new Player(collision);
  player.position.set(x, y, z);
  return { player, input };
}

function run(player: Player, input: Input, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) player.fixedUpdate(dt, input);
}

describe('LevelCollision vertical contact', () => {
  it('pushes a capsule resting in a prop top up and reports standing on it', () => {
    const position = new Vector3(-4, 0.97, -2); // 3 cm into the top of the 1.0 m crate
    const contact = collision.pushOut(position, r, 1.8, 5, true);
    expect(contact.up).toBe(true);
    expect(position.y).toBeCloseTo(1.0, 2);
  });

  it('reports a ceiling when a capsule is pushed down by the beam', () => {
    const position = new Vector3(6.2, 0, -3.5); // under the beam (bottom at 1.3 m), standing height 1.8 m
    position.y = -0.0; // feet on the floor: the head is inside the beam
    const contact = collision.pushOut(position, r, 1.8, 5, true);
    expect(contact.down).toBe(true);
  });

  it('keeps the sideways-only mode sideways only', () => {
    const position = new Vector3(-4, 0.97, -2);
    collision.pushOut(position, r, 1.8, 5);
    expect(position.y).toBeCloseTo(0.97, 5);
  });
});

describe('overlapsCapsule', () => {
  const tolerance = playerConfig.clearanceToleranceM;

  it('is false in open space and true inside a prop', () => {
    expect(collision.overlapsCapsule(new Vector3(0, 0, 4.5), r, 1.8, tolerance)).toBe(false);
    expect(collision.overlapsCapsule(new Vector3(-4, 0, -2), r, 1.8, tolerance)).toBe(true);
  });

  it('is false for a capsule just touching a wall', () => {
    expect(collision.overlapsCapsule(new Vector3(8 - r, 0, 0), r, 1.8, tolerance)).toBe(false);
  });

  it('says a standing capsule does not fit under the beam but a crouched one does', () => {
    expect(collision.overlapsCapsule(new Vector3(6.2, 0, -3.5), r, playerConfig.heightM, tolerance)).toBe(true);
    expect(collision.overlapsCapsule(new Vector3(6.2, 0, -3.5), r, playerConfig.crouchHeightM, tolerance)).toBe(false);
  });
});

describe('gravity and standing on things', () => {
  it('stays on the floor, grounded', () => {
    const { player, input } = newPlayer(0, 0, 4.5);
    run(player, input, 1);
    expect(player.position.y).toBe(0);
    expect(player.grounded).toBe(true);
  });

  it('falls onto the top of a crate and stands on it', () => {
    const { player, input } = newPlayer(-4, 3, -2);
    run(player, input, 1.5);
    expect(player.position.y).toBeCloseTo(1.0, 2);
    expect(player.grounded).toBe(true);
  });

  it('walks off the edge of a crate and drops to the floor', () => {
    const { player, input } = newPlayer(-4, 1.0, -2);
    run(player, input, 0.2);
    input.keyDown('KeyW'); // facing north (-z), toward and past the crate's far edge
    run(player, input, 1.5);
    expect(player.position.z).toBeLessThan(-2.8); // well off the far edge (z -2.5)
    run(player, input, 1);
    expect(player.position.y).toBe(0);
    expect(player.grounded).toBe(true);
  });
});

describe('the walkway behind the platform', () => {
  it('is wide enough to walk through, so nobody gets wedged there (found by the random-play test)', () => {
    // The platform's north face is at z -5 and the north wall's inside at z -6: 1.0 m, wider than the 0.6 m player.
    const { player, input } = newPlayer(-4, 0, -5.5);
    input.keyDown('KeyD'); // facing north, D walks east along the walkway
    run(player, input, 2);
    expect(player.position.x).toBeGreaterThan(-1);
    expect(player.position.y).toBe(0);
  });
});

describe('standing up under a low ceiling', () => {
  it('stays crouched under the beam after C is released, and stands when out from under it', () => {
    const { player, input } = newPlayer(6.2, 0, -3.5);
    input.keyDown('KeyC');
    run(player, input, 0.5);
    expect(player.stance.stance).toBe('crouching');
    input.keyUp('KeyC');
    run(player, input, 0.5);
    expect(player.stance.stance).toBe('crouching'); // no room
    player.position.set(6.2, 0, -0.5); // out from under the beam
    run(player, input, 0.2);
    expect(player.stance.stance).toBe('standing');
  });
});
