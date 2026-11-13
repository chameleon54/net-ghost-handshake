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
    vaultMinSpeedMps: 3,
    vaultMinSec: 0.2,
    vaultMaxSec: 0.6,
    vaultArcHeightM: 0.4,
    vaultArcMinHeightM: 0.25,
    vaultHoldDecisionSec: 0.1,
    climbLowSec: 0.4,
    climbHighSec: 0.6,
    climbForwardLag: 1.5,
    mantleMinHeightM: 0.3,
    vaultMaxHeightM: 1.1,
  };
  const spot = (x: number, y: number, z: number): Spot => ({ x, y, z });
  // A 1.0 m obstacle 1 m in front of the player, vaulted to a landing 2 m ahead (z is forward, negative).
  const lowPlan: MantlePlan = { band: 'low', topYM: 1, onTop: spot(0, 1, -1), over: spot(0, 0, -2) };
  const highPlan: MantlePlan = { band: 'high', topYM: 1.5, onTop: spot(0, 1.5, -1), over: null };
  const stepSec = 0.01;

  /** Runs a move to its end, returning every position it passed through and how long it took. */
  function run(m: Mantle, heldFor: number): { path: Spot[]; seconds: number } {
    const path: Spot[] = [];
    let seconds = 0;
    while (m.active && seconds < 5) {
      const out = spot(0, 0, 0);
      seconds += stepSec;
      m.update(stepSec, seconds <= heldFor, out);
      path.push(out);
    }
    return { path, seconds };
  }
  const vault = (entryZ: number, plan = lowPlan, heldFor = 0): { m: Mantle } & ReturnType<typeof run> => {
    const m = new Mantle(settings);
    m.start(spot(0, 0, 0), plan, { x: 0, z: entryZ });
    return { m, ...run(m, heldFor) };
  };

  it('a tap goes over and lands at the landing spot, keeping the speed it came in with', () => {
    const { m, path } = vault(-5);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 0, z: -2 });
    expect(m.exitVelocity.x).toBeCloseTo(0);
    expect(m.exitVelocity.z).toBeCloseTo(-5);
  });

  it('moves forward and up together from the very start, as one arc, never going backwards', () => {
    const { path } = vault(-5);
    const quarter = path[Math.floor(path.length / 4)];
    expect(quarter.z).toBeLessThan(-0.1); // already well on its way forward ...
    expect(quarter.y).toBeGreaterThan(0.02); // ... and already lifting
    for (let i = 1; i < path.length; i++) expect(path[i].z, `step ${i}`).toBeLessThanOrEqual(path[i - 1].z + 1e-9);
  });

  it('lifts only a little: nowhere near the height of the obstacle, which is what made the old vault feel like climbing on it', () => {
    const { path } = vault(-5);
    const highest = Math.max(...path.map((p) => p.y));
    expect(highest).toBeLessThanOrEqual(0.4 + 1e-6);
    expect(highest).toBeLessThan(lowPlan.topYM / 2);
  });

  it('is a smooth arc: up to a peak in the middle and back down, with no jump between steps', () => {
    const { path } = vault(-5);
    const ys = path.map((p) => p.y);
    const peak = ys.indexOf(Math.max(...ys));
    expect(peak).toBeGreaterThan(path.length * 0.3);
    expect(peak).toBeLessThan(path.length * 0.7);
    for (let i = 1; i <= peak; i++) expect(ys[i], `rising ${i}`).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9);
    for (let i = peak + 1; i < ys.length; i++) expect(ys[i], `falling ${i}`).toBeLessThanOrEqual(ys[i - 1] + 1e-9);
    for (let i = 1; i < path.length; i++) {
      const stepM = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
      expect(stepM, `step ${i}`).toBeLessThan(0.13); // at most about 13 m/s: no teleport
    }
  });

  it('takes less time at speed and more when slow, within the limits', () => {
    const sprint = vault(-6).seconds;
    const walk = vault(-4).seconds;
    const standing = vault(0).seconds;
    expect(sprint).toBeLessThan(walk);
    expect(walk).toBeLessThanOrEqual(standing + stepSec);
    expect(vault(-100).seconds).toBeGreaterThanOrEqual(settings.vaultMinSec - stepSec); // never faster than the shortest time
    expect(standing).toBeLessThanOrEqual(settings.vaultMaxSec + stepSec); // never slower than the longest
  });

  it('a higher obstacle gets a bigger lift, between the two limits', () => {
    const lowest = vault(-5, { ...lowPlan, topYM: 0.3 });
    const highest = vault(-5, { ...lowPlan, topYM: 1.1 });
    const peak = (r: { path: Spot[] }) => Math.max(...r.path.map((p) => p.y));
    expect(peak(lowest)).toBeCloseTo(0.25, 2);
    expect(peak(highest)).toBeCloseTo(0.4, 2);
    expect(vault(-5, { ...lowPlan, topYM: 0.7 }).path.length).toBeGreaterThan(0);
    expect(peak(vault(-5, { ...lowPlan, topYM: 0.7 }))).toBeGreaterThan(peak(lowest));
    expect(peak(vault(-5, { ...lowPlan, topYM: 0.7 }))).toBeLessThan(peak(highest));
  });

  it('holding Space past the decision time turns the vault into climbing onto the obstacle, without a jump', () => {
    const { m, path } = vault(-5, lowPlan, 5);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 1, z: -1 });
    expect(m.exitVelocity.z).toBeCloseTo(0);
    for (let i = 1; i < path.length; i++) {
      const stepM = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
      expect(stepM, `step ${i}`).toBeLessThan(0.13);
    }
  });

  it('releasing Space before the decision time is still a vault', () => {
    const { path } = vault(-5, lowPlan, 0.05);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 0, z: -2 });
  });

  it('holding Space where there is no room to stand on top just vaults', () => {
    const { path } = vault(-5, { ...lowPlan, onTop: null }, 5);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 0, z: -2 });
  });

  it('low cover too deep to vault is climbed onto', () => {
    const { path } = vault(-5, { ...lowPlan, over: null }, 0);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 1, z: -1 });
  });

  it('a tall ledge is climbed in one motion: it ends exactly on top and takes longer than a vault', () => {
    const climb = vault(0, highPlan);
    expect(climb.path[climb.path.length - 1]).toEqual({ x: 0, y: 1.5, z: -1 });
    expect(climb.seconds).toBeGreaterThan(vault(-5).seconds);
    expect(climb.seconds).toBeCloseTo(settings.climbHighSec, 1);
  });

  it('a climb moves forward and up together from the start, never going down or backwards (it no longer rises first and then moves forward)', () => {
    const { path } = vault(0, highPlan);
    const early = path[Math.floor(0.25 * path.length)];
    expect(early.y).toBeGreaterThan(0.05); // rising ...
    expect(early.z).toBeLessThan(-0.005); // ... and already moving forward at the same time
    for (let i = 1; i < path.length; i++) {
      expect(path[i].y, `step ${i} y`).toBeGreaterThanOrEqual(path[i - 1].y - 1e-9);
      expect(path[i].z, `step ${i} z`).toBeLessThanOrEqual(path[i - 1].z + 1e-9);
    }
  });

  it('the forward part lags behind the rise, so you rise along the face and pull over the edge', () => {
    const { path } = vault(0, highPlan);
    for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
      const p = path[Math.floor(fraction * path.length)];
      const risen = p.y / 1.5; // how much of the height is done
      const forward = -p.z / 1; // how much of the forward distance is done
      expect(forward, `at ${fraction}`).toBeLessThan(risen);
    }
  });

  it('a forward lag of 1 is a straight diagonal: equal progress forward and up at every step', () => {
    const m = new Mantle({ ...settings, climbForwardLag: 1 });
    m.start(spot(0, 0, 0), highPlan, { x: 0, z: 0 });
    const { path } = run(m, 0);
    for (const p of path) expect(-p.z / 1).toBeCloseTo(p.y / 1.5, 6);
  });

  it('a climb has no jump between steps', () => {
    const { path } = vault(0, highPlan);
    for (let i = 1; i < path.length; i++) {
      const stepM = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
      expect(stepM, `step ${i}`).toBeLessThan(0.05); // under 5 m/s
    }
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

  /** Climbs from here and returns the closest the camera gets to any surface, as a small sphere at the eye. */
  function cameraInsideDuringClimb(x: number, z: number, holdSpace: boolean): { climbed: boolean; inside: boolean } {
    const { player, input } = setup(x, z);
    input.keyDown('Space');
    if (!holdSpace) input.keyUp('Space');
    let inside = false;
    let climbed = false;
    const eye = new Vector3();
    for (let i = 0; i < 120; i++) {
      player.fixedUpdate(dt, input);
      if (player.mantle.active) climbed = true;
      // A sphere of radius 0.1 m at the eye: the camera's near plane reaches about 0.09 m sideways.
      eye.set(player.position.x, player.position.y + player.eyeHeightNowM - 0.1, player.position.z);
      if (collision.overlapsCapsule(eye, 0.1, 0.2, 0.01)) inside = true;
    }
    return { climbed, inside };
  }

  it('the camera never goes inside the obstacle while climbing the 1.5 m crate, the 1.9 m platform or the low crate', () => {
    for (const [name, x, z, hold] of [
      ['1.5 m crate', 3, -1.7, false],
      ['1.9 m platform', -2, -2.3, false],
      ['1.0 m crate, Space held', -4, -0.9, true],
      ['bench, Space held', -2.5, 4.0, true],
    ] as const) {
      const result = cameraInsideDuringClimb(x, z, hold);
      expect(result.climbed, `${name} did not climb`).toBe(true);
      expect(result.inside, `${name}: the camera went inside the obstacle`).toBe(false);
    }
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
