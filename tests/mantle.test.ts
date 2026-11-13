import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { playerConfig } from '../src/config/player';
import { Input } from '../src/core/input';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { LedgeProbe, Mantle, type MantlePlan, type Spot } from '../src/player/mantle';
import { Player } from '../src/player/player';

const { collision } = buildGreybox(greyboxRoom);
const probe = new LedgeProbe(collision);
const standing = playerConfig.heightM;
const north = 0; // yaw 0 looks toward -z

// Every case stands the player in front of a prop of the test room, looking at it.
describe('LedgeProbe against the test room', () => {
  it('the 1.0 m low crate can be vaulted or climbed onto', () => {
    const plan = probe.probe(new Vector3(-4, 0, -0.9), north, standing);
    expect(plan?.band).toBe('low');
    expect(plan?.topYM).toBeCloseTo(1.0, 2);
    expect(plan?.onTop).not.toBeNull();
    expect(plan?.over).not.toBeNull();
    expect(plan?.over?.z).toBeLessThan(-2.5); // lands beyond the crate's far face
    expect(plan?.over?.y).toBe(0);
  });

  it('the 1.0 m bench, only 0.6 m deep, can be vaulted and stood on', () => {
    const plan = probe.probe(new Vector3(-2.5, 0, 4.0), north, standing);
    expect(plan?.band).toBe('low');
    expect(plan?.over).not.toBeNull();
    expect(plan?.onTop).not.toBeNull();
  });

  it('the 1.5 m tall crate can only be climbed', () => {
    const plan = probe.probe(new Vector3(3, 0, -1.7), north, standing);
    expect(plan?.band).toBe('high');
    expect(plan?.topYM).toBeCloseTo(1.5, 2);
    expect(plan?.onTop).not.toBeNull();
    expect(plan?.over).toBeNull();
  });

  it('the 1.9 m platform, just under the 2.0 m limit, can be climbed', () => {
    const plan = probe.probe(new Vector3(-2, 0, -2.3), north, standing);
    expect(plan?.band).toBe('high');
    expect(plan?.topYM).toBeCloseTo(1.9, 2);
    expect(plan?.onTop).not.toBeNull();
  });

  it('things taller than 2.0 m give nothing: the pillar (2.2 m), the L-wall (2.5 m), the partition (2.4 m), the outer wall (3 m)', () => {
    expect(probe.probe(new Vector3(0, 0, 0.9), north, standing)).toBeNull(); // pillar, from the south
    expect(probe.probe(new Vector3(5, 0, 2.9), north, standing)).toBeNull(); // L-wall
    expect(probe.probe(new Vector3(-6.75, 0, 2.4), north, standing)).toBeNull(); // partition
    expect(probe.probe(new Vector3(0, 0, -5.4), north, standing)).toBeNull(); // north wall
  });

  it('a wall is not climbable, even from a platform where its top is only 1.3 m above the feet (found by the random-play test)', () => {
    // A 1.9 m platform with a 3.2 m block just beyond its edge: the top is 1.3 m above a player standing on the platform.
    const room = [
      { kind: 'prop', xM: 0, zM: 0, widthM: 2, depthM: 2, heightM: 1.9 },
      { kind: 'wall', xM: 0, zM: -1.9, widthM: 4, depthM: 1.0, heightM: 3.2 },
    ] as const;
    const asWall = new LedgeProbe(buildGreybox(room).collision);
    expect(asWall.probe(new Vector3(0, 1.9, -0.7), north, standing)).toBeNull();
    // Marked climbable, the same shape can be climbed: the flag is what decides.
    const asProp = new LedgeProbe(buildGreybox([room[0], { ...room[1], climbable: true }]).collision);
    expect(asProp.probe(new Vector3(0, 1.9, -0.7), north, standing)?.band).toBe('high');
  });

  it('a wall in front blocks the climb even when a climbable prop is just behind it', () => {
    const wallThenCrate = buildGreybox([
      { kind: 'wall', xM: 0, zM: -1, widthM: 2, depthM: 0.2, heightM: 1.0 },
      { kind: 'prop', xM: 0, zM: -1.8, widthM: 2, depthM: 1, heightM: 1.0 },
    ]);
    const p = new LedgeProbe(wallThenCrate.collision);
    expect(p.probe(new Vector3(0, 0, -0.4), north, standing)).toBeNull();
  });

  it('gives nothing in open space or when the obstacle is out of reach', () => {
    expect(probe.probe(new Vector3(0, 0, 4.5), north, standing)).toBeNull();
    expect(probe.probe(new Vector3(-4, 0, 0.5), north, standing)).toBeNull(); // 2 m from the crate
  });

  it('gives nothing when looking away from the obstacle', () => {
    expect(probe.probe(new Vector3(-4, 0, -0.9), Math.PI, standing)).toBeNull(); // looking south
  });
});

describe('Mantle (the scripted move)', () => {
  const settings = {
    vaultRiseSec: 0.2,
    vaultOverSec: 0.2,
    climbLowTopSec: 0.2,
    climbRiseSec: 0.4,
    climbTopSec: 0.2,
    vaultApexClearanceM: 0.1,
  };
  const spot = (x: number, y: number, z: number): Spot => ({ x, y, z });
  const lowPlan: MantlePlan = { band: 'low', topYM: 1, onTop: spot(0, 1, -1), over: spot(0, 0, -2) };
  const highPlan: MantlePlan = { band: 'high', topYM: 1.5, onTop: spot(0, 1.5, -1), over: null };
  const out = spot(0, 0, 0);

  function finish(m: Mantle, spaceHeld: boolean, stepSec = 0.05): number {
    let elapsed = 0;
    while (m.active && elapsed < 5) {
      m.update(stepSec, spaceHeld, out);
      elapsed += stepSec;
    }
    return elapsed;
  }

  it('a tap goes over a low obstacle and lands at the landing spot, keeping its speed', () => {
    const m = new Mantle(settings);
    m.start(spot(0, 0, 0), lowPlan, { x: 0, z: -5 });
    finish(m, false);
    expect(out).toEqual({ x: 0, y: 0, z: -2 });
    expect(m.exitVelocity.x).toBeCloseTo(0);
    expect(m.exitVelocity.z).toBeCloseTo(-5);
  });

  it('holding Space at the top stays on top of a low obstacle, standing still', () => {
    const m = new Mantle(settings);
    m.start(spot(0, 0, 0), lowPlan, { x: 0, z: -5 });
    finish(m, true);
    expect(out).toEqual({ x: 0, y: 1, z: -1 });
    expect(m.exitVelocity.z).toBeCloseTo(0);
  });

  it('a tall ledge is always climbed onto, even without holding Space', () => {
    const m = new Mantle(settings);
    m.start(spot(0, 0, 0), highPlan, { x: 0, z: 0 });
    finish(m, false);
    expect(out).toEqual({ x: 0, y: 1.5, z: -1 });
  });

  it('rises above the top during a vault, and the tall climb takes longer than the vault', () => {
    const m = new Mantle(settings);
    m.start(spot(0, 0, 0), lowPlan, { x: 0, z: -5 });
    m.update(0.2, false, out); // end of the rise
    expect(out.y).toBeCloseTo(1.1); // top 1.0 + apex clearance 0.1
    const vaultSec = 0.2 + finish(m, false);

    const climb = new Mantle(settings);
    climb.start(spot(0, 0, 0), highPlan, { x: 0, z: 0 });
    const climbSec = finish(climb, false);
    expect(climbSec).toBeGreaterThan(vaultSec);
  });

  it('never moves sideways during the rise', () => {
    const m = new Mantle(settings);
    m.start(spot(3, 0, 4), lowPlan, { x: 0, z: -5 });
    m.update(0.1, false, out);
    expect(out.x).toBe(3);
    expect(out.z).toBe(4);
    expect(out.y).toBeGreaterThan(0);
  });
});

describe('the whole thing through the real Player', () => {
  const dt = 1 / 60;
  function setup(x: number, z: number): { player: Player; input: Input } {
    const input = new Input();
    input.enabled = true;
    const player = new Player(collision);
    player.position.set(x, 0, z);
    return { player, input };
  }
  function run(player: Player, input: Input, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / dt); i++) player.fixedUpdate(dt, input);
  }

  it('a tap of Space vaults over the low crate and ends on the floor on the far side', () => {
    const { player, input } = setup(-4, -0.9);
    input.keyDown('Space');
    input.keyUp('Space');
    run(player, input, 1.0);
    expect(player.mantle.active).toBe(false);
    expect(player.position.z).toBeLessThan(-2.5);
    expect(player.position.y).toBe(0);
  });

  it('holding Space climbs onto the low crate and stays there', () => {
    const { player, input } = setup(-4, -0.9);
    input.keyDown('Space');
    run(player, input, 1.0); // Space held throughout
    expect(player.mantle.active).toBe(false);
    expect(player.position.y).toBeCloseTo(1.0, 2);
    expect(player.position.z).toBeLessThan(-1.5);
    expect(player.position.z).toBeGreaterThan(-2.5);
    expect(player.grounded).toBe(true);
  });

  it('Space at the 1.9 m platform climbs onto it', () => {
    const { player, input } = setup(-2, -2.3);
    input.keyDown('Space');
    run(player, input, 1.5);
    expect(player.position.y).toBeCloseTo(1.9, 2);
    expect(player.grounded).toBe(true);
  });

  it('Space at the pillar does nothing', () => {
    const { player, input } = setup(0, 0.9);
    input.keyDown('Space');
    run(player, input, 0.5);
    expect(player.mantle.active).toBe(false);
    expect(player.position.y).toBe(0);
  });

  it('a sprint-vault carries its speed on', () => {
    const { player, input } = setup(-4, 2.5);
    input.keyDown('ShiftLeft');
    input.keyDown('KeyW');
    // Sprint toward the low crate (near face at z -1.5) and press Space when within reach of it.
    let guard = 0;
    while (player.position.z > -0.85 && guard++ < 300) player.fixedUpdate(dt, input);
    input.keyDown('Space');
    input.keyUp('Space');
    player.fixedUpdate(dt, input);
    expect(player.mantle.active).toBe(true);
    while (player.mantle.active) player.fixedUpdate(dt, input);
    expect(Math.hypot(player.mantle.exitVelocity.x, player.mantle.exitVelocity.z)).toBeGreaterThan(4);
  });

  it('no sprint or lean state is reported while climbing', () => {
    const { player, input } = setup(-4, -0.9);
    input.keyDown('ShiftLeft');
    input.keyDown('KeyW');
    input.keyDown('Space');
    run(player, input, 0.1);
    expect(player.mantle.active).toBe(true);
    expect(player.isSprinting).toBe(false);
  });
});
