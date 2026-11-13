import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { audioConfig, audioConfigDefaults } from '../src/config/audio';
import { grenadeConfig, grenadeConfigDefaults } from '../src/config/grenade';
import { pistolConfig } from '../src/config/pistol';
import { rifleConfig } from '../src/config/rifle';
import { viewmodelConfigDefaults } from '../src/config/viewmodel';
import { WeaponSounds } from '../src/audio/weaponSounds';
import type { SoundName } from '../src/audio/recipes';
import type { PlayOptions, SoundPlayer } from '../src/audio/soundPlayer';
import { EventBus } from '../src/core/events';
import { Dummy } from '../src/enemies/dummy';
import { CameraShake } from '../src/fx/cameraShake';
import { Explosions } from '../src/fx/explosions';
import type { RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun } from '../src/weapons/gun';
import { blastDamageAt, isShielded, resolveBlast, type BlastTarget } from '../src/weapons/grenade/blast';
import { Grenade, type GrenadeHooks } from '../src/weapons/grenade/grenade';
import { dummyBlastTarget, GrenadeSystem } from '../src/weapons/grenade/grenadeSystem';
import { GrenadeThrower } from '../src/weapons/grenade/thrower';
import { Knife } from '../src/weapons/knife';
import { ViewmodelAnimator, type AnimatorInput } from '../src/weapons/viewmodel/animator';
import { WeaponSet } from '../src/weapons/weaponSet';

const dtSec = 1 / 60;
const farCrate: RoomBox = { kind: 'prop', xM: 80, zM: 80, widthM: 1, depthM: 1, heightM: 1 };
const wallAtX3: RoomBox = { kind: 'wall', xM: 3, zM: 0, widthM: 0.2, depthM: 10, heightM: 3 }; // x from 2.9 to 3.1
const level = (boxes: RoomBox[] = []) => buildGreybox([farCrate, ...boxes]).collision;

/** Collects what a grenade says. */
function hooks() {
  const bounces: number[] = [];
  const explosions: Vector3[] = [];
  const h: GrenadeHooks = {
    onBounce: (_position, speedMps) => bounces.push(speedMps),
    onExplode: (position) => explosions.push(position.clone()),
  };
  return { h, bounces, explosions };
}

describe('Grenade', () => {
  it('falls, bounces off the floor losing energy each time, comes to rest, and explodes once when the fuse ends', () => {
    const collision = level();
    const { h, bounces, explosions } = hooks();
    const g = new Grenade();
    g.launch(new Vector3(0, 2, 0), new Vector3(0, 0, 0));
    for (let i = 0; i < 60 * (grenadeConfig.fuseSec + 1); i++) g.update(dtSec, collision, h);
    expect(bounces.length).toBeGreaterThanOrEqual(2);
    expect(bounces[0]).toBeGreaterThan(5); // it fell 2 m: about 6 m/s into the floor
    for (let i = 1; i < bounces.length; i++) expect(bounces[i]).toBeLessThan(bounces[i - 1]); // each bounce is softer
    expect(g.resting).toBe(true);
    expect(g.position.y).toBeLessThan(0.1);
    expect(explosions).toHaveLength(1);
    expect(g.active).toBe(false);
    expect(explosions[0].y).toBeLessThan(0.1); // it went off where it came to rest
  });

  it('goes off exactly when the fuse ends, wherever it is', () => {
    const collision = level();
    const { h, explosions } = hooks();
    const g = new Grenade();
    g.launch(new Vector3(0, 1, 0), new Vector3(5, 3, 0));
    for (let i = 0; i < Math.round((grenadeConfig.fuseSec - 0.1) / dtSec); i++) g.update(dtSec, collision, h);
    expect(explosions).toHaveLength(0);
    for (let i = 0; i < Math.round(0.3 / dtSec); i++) g.update(dtSec, collision, h);
    expect(explosions).toHaveLength(1);
  });

  it('bounces off a wall instead of passing through, even when thrown hard', () => {
    const collision = level([wallAtX3]);
    const { h } = hooks();
    const g = new Grenade();
    g.launch(new Vector3(0, 1.5, 0), new Vector3(40, 0, 0));
    let furthest = 0;
    for (let i = 0; i < 120; i++) {
      g.update(dtSec, collision, h);
      furthest = Math.max(furthest, g.position.x);
    }
    expect(furthest).toBeLessThan(2.95);
    expect(g.position.x).toBeLessThan(2.9);
  });

  it('can be thrown over a low wall and lands beyond it', () => {
    const lowWall: RoomBox = { kind: 'wall', xM: 3, zM: 0, widthM: 0.2, depthM: 10, heightM: 1 };
    const collision = level([lowWall]);
    const { h } = hooks();
    const g = new Grenade();
    g.launch(new Vector3(0, 1.6, 0), new Vector3(6, 5, 0));
    for (let i = 0; i < 90; i++) g.update(dtSec, collision, h);
    expect(g.position.x).toBeGreaterThan(3.2);
  });

  it('a stopped grenade keeps its fuse running and does nothing else', () => {
    const collision = level();
    const { h, bounces } = hooks();
    const g = new Grenade();
    g.launch(new Vector3(0, 0.03, 0), new Vector3(0, 0, 0));
    for (let i = 0; i < 120; i++) g.update(dtSec, collision, h);
    const after = bounces.length;
    for (let i = 0; i < 30; i++) g.update(dtSec, collision, h);
    expect(bounces.length).toBe(after);
    expect(g.fuseLeftSec).toBeLessThan(grenadeConfig.fuseSec - 2);
  });
});

describe('blast damage', () => {
  it('is full at the centre, falls in a straight line to the edge value, and stops at the radius', () => {
    expect(blastDamageAt(0)).toBe(grenadeConfig.damageAtCentre);
    const half = blastDamageAt(grenadeConfig.blastRadiusM / 2);
    expect(half).toBeCloseTo((grenadeConfig.damageAtCentre + grenadeConfig.damageAtEdge) / 2);
    expect(blastDamageAt(grenadeConfig.blastRadiusM - 0.001)).toBeCloseTo(grenadeConfig.damageAtEdge, 0);
    expect(blastDamageAt(grenadeConfig.blastRadiusM)).toBe(0);
    expect(blastDamageAt(grenadeConfig.blastRadiusM + 10)).toBe(0);
  });

  it('a 100-health target dies within about 2 m with the starting values, is badly hurt out to 3.5 m, and survives at the edge', () => {
    expect(blastDamageAt(2)).toBeGreaterThanOrEqual(100);
    expect(blastDamageAt(3.5)).toBeGreaterThan(50);
    expect(blastDamageAt(3.5)).toBeLessThan(100);
    expect(blastDamageAt(4.8)).toBeLessThan(40);
  });
});

describe('cover against a blast', () => {
  const collision = level([wallAtX3]);

  it('a wall between the blast and a target shields it; a clear line does not', () => {
    expect(isShielded(new Vector3(0, 0, 0), new Vector3(4.5, 1, 0), collision)).toBe(true);
    expect(isShielded(new Vector3(0, 0, 3), new Vector3(2, 1, 3), collision)).toBe(false);
  });

  it('a wall right behind the target is not between them', () => {
    expect(isShielded(new Vector3(0, 0, 0), new Vector3(2.7, 1, 0), collision)).toBe(false);
  });

  it('low cover shields a chest-height target standing right behind it, and the floor never does', () => {
    const crate = level([{ kind: 'prop', xM: 2, zM: 0, widthM: 1, depthM: 1, heightM: 1.2 }]);
    expect(isShielded(new Vector3(0, 0, 0), new Vector3(3.6, 1, 0), crate)).toBe(true);
    expect(isShielded(new Vector3(0, 0, 4), new Vector3(3.6, 1, 4), crate)).toBe(false);
  });

  it('resolveBlast hurts what is in range and in the open, and skips the shielded, the far and the already down', () => {
    const hurt: Record<string, number> = {};
    const target = (name: string, x: number, vulnerable = true): BlastTarget => ({
      chest: (out) => out.set(x, 1, 0),
      vulnerable: () => vulnerable,
      hurt: (damage) => (hurt[name] = damage),
    });
    // The blast is at x -1: the wall is at x 2.9 to 3.1.
    const results = resolveBlast(new Vector3(-1, 0, 0), collision, [target('near', 1), target('behindWall', 4), target('far', -9), target('down', 0, false)]);
    expect(Object.keys(hurt)).toEqual(['near']);
    expect(results).toHaveLength(1);
    expect(hurt.near).toBeCloseTo(blastDamageAt(Math.hypot(2, 1)), 1);
  });
});

describe('GrenadeThrower', () => {
  const setup = (start = 2) => {
    const events = new EventBus<WeaponEvents>();
    const seen = { pin: 0, release: 0 };
    events.on('grenade:pin', () => seen.pin++);
    events.on('grenade:release', () => seen.release++);
    return { thrower: new GrenadeThrower(events, start), seen };
  };
  const press = { pressed: true, canThrow: true };
  const none = { pressed: false, canThrow: true };
  const run = (thrower: GrenadeThrower, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) thrower.update(dtSec, none);
  };

  it('carries the starting grenades and never more than the limit', () => {
    expect(setup(2).thrower.count).toBe(2);
    expect(setup(10).thrower.count).toBe(grenadeConfig.carryLimit);
  });

  it('G pulls the pin at once, lets go after the wind-up, and is busy until the follow-through ends', () => {
    const { thrower, seen } = setup();
    thrower.update(dtSec, press);
    expect(seen.pin).toBe(1);
    expect(thrower.count).toBe(1);
    expect(thrower.busy).toBe(true);
    run(thrower, grenadeConfig.windupSec - 0.1);
    expect(seen.release).toBe(0);
    run(thrower, 0.15);
    expect(seen.release).toBe(1);
    expect(thrower.busy).toBe(true);
    run(thrower, grenadeConfig.followThroughSec);
    expect(thrower.busy).toBe(false);
    expect(seen.release).toBe(1); // only once
  });

  it('reports progress, and the share at which the grenade leaves the hand', () => {
    const { thrower } = setup();
    expect(thrower.progress).toBe(0);
    thrower.update(dtSec, press);
    run(thrower, grenadeConfig.windupSec);
    expect(thrower.progress).toBeCloseTo(thrower.releaseShare, 1);
    expect(thrower.releaseShare).toBeCloseTo(grenadeConfig.windupSec / (grenadeConfig.windupSec + grenadeConfig.followThroughSec));
  });

  it('says once when the throw has ended and the hands are free', () => {
    const { thrower } = setup();
    thrower.update(dtSec, press);
    let finished = 0;
    for (let i = 0; i < 120; i++) {
      thrower.update(dtSec, none);
      if (thrower.justFinished) finished++;
    }
    expect(finished).toBe(1);
  });

  it('does nothing with none left, when it may not throw, or while already throwing', () => {
    const { thrower, seen } = setup(1);
    thrower.update(dtSec, { pressed: true, canThrow: false });
    expect(seen.pin).toBe(0);
    thrower.update(dtSec, press);
    thrower.update(dtSec, press); // pressed again mid-throw
    expect(seen.pin).toBe(1);
    run(thrower, 2);
    thrower.update(dtSec, press); // none left
    expect(seen.pin).toBe(1);
    expect(thrower.count).toBe(0);
  });

  it('can be given more, up to the limit', () => {
    const { thrower } = setup(0);
    expect(thrower.give(1)).toBe(1);
    expect(thrower.give(5)).toBe(grenadeConfig.carryLimit - 1);
    expect(thrower.count).toBe(grenadeConfig.carryLimit);
    expect(thrower.give(1)).toBe(0);
  });
});

describe('GrenadeSystem', () => {
  // The player stands at the origin at eye height 1.6, looking down -z (a camera with no rotation does).
  function setup(boxes: RoomBox[] = [], dummies: Dummy[] = []) {
    const collision = level(boxes);
    const events = new EventBus<WeaponEvents>();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 0);
    const player = new Vector3(0, 0, 0);
    const playerTarget: BlastTarget = {
      chest: (out) => out.set(player.x, player.y + grenadeConfig.targetChestHeightM, player.z),
      vulnerable: () => true,
      hurt: () => {},
    };
    const targets = dummies.map((d) => dummyBlastTarget(d, events));
    const system = new GrenadeSystem(new Scene(), events, collision, camera, targets, playerTarget);
    const seen = { thrown: 0, bounced: 0, exploded: [] as Vector3[], blasts: [] as { damage: number; distanceM: number }[], deafened: [] as number[], hits: 0 };
    events.on('grenade:thrown', () => seen.thrown++);
    events.on('grenade:bounced', () => seen.bounced++);
    events.on('grenade:exploded', ({ position }) => seen.exploded.push(position.clone()));
    events.on('player:blast', (b) => seen.blasts.push(b));
    events.on('player:deafened', ({ intensity }) => seen.deafened.push(intensity));
    events.on('target:hit', () => seen.hits++);
    const throwNow = () => events.emit('grenade:release', undefined);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dtSec); i++) system.update(dtSec);
    };
    return { system, events, seen, throwNow, run, player, camera };
  }

  it('a throw sends a grenade forward and a little up, it bounces, and it explodes after the fuse', () => {
    const { seen, throwNow, run, system } = setup();
    throwNow();
    expect(seen.thrown).toBe(1);
    expect(system.live).toBe(1);
    run(grenadeConfig.fuseSec - 0.2);
    expect(seen.exploded).toHaveLength(0);
    expect(seen.bounced).toBeGreaterThanOrEqual(1);
    run(0.4);
    expect(seen.exploded).toHaveLength(1);
    expect(system.live).toBe(0);
    expect(seen.exploded[0].z).toBeLessThan(-5); // it went forward (down -z)
  });

  it('a blast kills a dummy close to it and the hit marker event says so; a far one is untouched', () => {
    const near = new Dummy(0, -8);
    const far = new Dummy(15, -8);
    const { throwNow, run, seen } = setup([], [near, far]);
    // Throw, then place the dummy where the grenade ends up, to be sure it is in range whatever the arc is.
    throwNow();
    run(grenadeConfig.fuseSec + 0.1);
    const landing = seen.exploded[0];
    const target = new Dummy(landing.x, landing.z);
    const second = setup([], [target]);
    second.throwNow();
    second.run(grenadeConfig.fuseSec + 0.1);
    expect(target.health.current).toBeLessThan(100);
    expect(far.health.current).toBe(100);
    expect(second.seen.hits).toBe(1);
  });

  it('a dummy behind a wall from the blast is not hurt', () => {
    // A wall right in front of the player: the grenade bounces back toward the player's side.
    const behind = new Dummy(0, -4); // on the far side of a wall at z -2 (x spans the room)
    const wall: RoomBox = { kind: 'wall', xM: 0, zM: -2, widthM: 12, depthM: 0.2, heightM: 3 };
    const { throwNow, run, seen } = setup([wall], [behind]);
    throwNow();
    run(grenadeConfig.fuseSec + 0.1);
    expect(seen.exploded).toHaveLength(1);
    expect(seen.exploded[0].z).toBeGreaterThan(-2); // it stayed on the player's side
    expect(behind.health.current).toBe(100);
  });

  it('the player takes the blast too, published for the health system: none when thrown far away, some when it goes off close', () => {
    const open = setup();
    open.throwNow();
    open.run(grenadeConfig.fuseSec + 0.1);
    const landing = open.seen.exploded[0];
    expect(Math.hypot(landing.x, landing.z)).toBeGreaterThan(5); // thrown far: out of its own radius
    expect(open.seen.blasts).toHaveLength(0);
    expect(open.seen.deafened).toHaveLength(0);

    // A gentle throw lands close: it goes off near the player.
    grenadeConfig.throwSpeedMps = 2;
    try {
      const close = setup();
      close.throwNow();
      close.run(grenadeConfig.fuseSec + 0.1);
      expect(close.seen.blasts).toHaveLength(1);
      expect(close.seen.blasts[0].damage).toBeGreaterThan(0);
      expect(close.seen.deafened).toHaveLength(1);
      expect(close.seen.deafened[0]).toBeGreaterThan(0);
      expect(close.seen.deafened[0]).toBeLessThanOrEqual(1);
    } finally {
      grenadeConfig.throwSpeedMps = grenadeConfigDefaults.throwSpeedMps;
    }
  });

  it('thrown against a wall that is right there it does not start inside it', () => {
    const wall: RoomBox = { kind: 'wall', xM: 0, zM: -0.3, widthM: 12, depthM: 0.2, heightM: 3 }; // 0.2 m ahead of the eyes
    const { throwNow, run, seen, system } = setup([wall]);
    throwNow();
    expect(system.live).toBe(1);
    run(0.5);
    expect(seen.bounced).toBeGreaterThanOrEqual(1);
  });
});

describe('Explosions and CameraShake', () => {
  it('a blast makes effects without errors and they fade away', () => {
    const events = new EventBus<WeaponEvents>();
    const scene = new Scene();
    const explosions = new Explosions(scene, events, level());
    for (let i = 0; i < 10; i++) events.emit('grenade:exploded', { position: new Vector3(i, 0.1, 0), radiusM: 5 });
    for (let i = 0; i < 60 * 3; i++) explosions.update(dtSec);
    expect(scene.children.filter((c) => c.visible && (c as { material?: { opacity?: number } }).material?.opacity === 1)).toHaveLength(0);
  });

  it('the camera shakes more the closer the blast, not at all beyond its reach, and settles', () => {
    const shakeFor = (distanceM: number) => {
      const events = new EventBus<WeaponEvents>();
      const shake = new CameraShake(events, () => new Vector3(), () => 0.9);
      events.emit('grenade:exploded', { position: new Vector3(distanceM, 0, 0), radiusM: 5 });
      let most = 0;
      for (let i = 0; i < 60; i++) {
        shake.update(dtSec);
        most = Math.max(most, Math.abs(shake.pitchRad), Math.abs(shake.yawRad));
      }
      return { most, shake };
    };
    expect(shakeFor(2).most).toBeGreaterThan(shakeFor(10).most);
    expect(shakeFor(grenadeConfig.shakeRadiusM + 5).most).toBe(0);
    const { shake } = shakeFor(2);
    for (let i = 0; i < 300; i++) shake.update(dtSec);
    expect(Math.abs(shake.pitchRad)).toBeLessThan(0.001);
  });
});

class FakePlayer implements SoundPlayer {
  played: { name: SoundName; options: PlayOptions }[] = [];
  ducks: { share: number; seconds: number }[] = [];
  play(name: SoundName, options: PlayOptions = {}): void {
    this.played.push({ name, options });
  }
  duck(share: number, seconds: number): void {
    this.ducks.push({ share, seconds });
  }
}

describe('grenade sounds and the ringing-ears hook', () => {
  const setup = () => {
    const events = new EventBus<WeaponEvents>();
    const player = new FakePlayer();
    const sounds = new WeaponSounds(events, player, () => 0.5);
    return { events, player, sounds };
  };

  it('the pin, the throw, the bounces and the blast each have a sound; the blast and bounces come from where they are', () => {
    const { events, player } = setup();
    events.emit('grenade:pin', undefined);
    events.emit('grenade:thrown', { position: new Vector3(), velocity: new Vector3() });
    events.emit('grenade:bounced', { position: new Vector3(2, 0, -3), speedMps: 5 });
    events.emit('grenade:exploded', { position: new Vector3(4, 0, -9), radiusM: 5 });
    expect(player.played.map((p) => p.name)).toEqual(['grenade-pin', 'grenade-throw', 'grenade-bounce', 'grenade-explosion']);
    expect(player.played[2].options.position).toBeDefined();
    expect(player.played[3].options.position?.toArray()).toEqual([4, 0, -9]);
  });

  it('bounces are quieter when softer and are not played in a rattle', () => {
    const { events, player, sounds } = setup();
    events.emit('grenade:bounced', { position: new Vector3(), speedMps: 1 });
    events.emit('grenade:bounced', { position: new Vector3(), speedMps: 6 }); // too soon
    expect(player.played).toHaveLength(1);
    for (let i = 0; i < 10; i++) sounds.update(dtSec);
    events.emit('grenade:bounced', { position: new Vector3(), speedMps: 6 });
    expect(player.played[1].options.volume!).toBeGreaterThan(player.played[0].options.volume!);
  });

  it('ringing ears: the hook is wired but silent until the sound volume is raised, and ducking is off until set', () => {
    const { events, player } = setup();
    events.emit('player:deafened', { intensity: 1, durationSec: 4 });
    expect(player.played).toHaveLength(0);
    expect(player.ducks).toHaveLength(0);
    audioConfig.earRingingVolume = 0.5;
    audioConfig.earRingingDuckShare = 0.6;
    try {
      events.emit('player:deafened', { intensity: 0.5, durationSec: 2 });
      expect(player.played.map((p) => p.name)).toEqual(['ear-ringing']);
      expect(player.played[0].options.volume).toBeCloseTo(0.25);
      expect(player.ducks).toEqual([{ share: 0.3, seconds: 2 }]);
    } finally {
      audioConfig.earRingingVolume = audioConfigDefaults.earRingingVolume;
      audioConfig.earRingingDuckShare = audioConfigDefaults.earRingingDuckShare;
    }
  });
});

describe('the grenade in the viewmodel and the weapon after a throw', () => {
  const idle: AnimatorInput = { weapon: 'grenade', drawProgress: 1, reloadProgress: null, sprinting: false, throwReleaseShare: 0.58 };

  it('the throw raises the hand, swings it forward through the release, and drops it away, smoothly', () => {
    const animator = new ViewmodelAnimator();
    let previousZ = 0;
    let highest = -Infinity;
    let forwardmost = Infinity;
    for (let i = 0; i <= 200; i++) {
      animator.update(dtSec, { ...idle, throwProgress: i / 200 });
      if (i > 0) expect(Math.abs(animator.pose.z - previousZ)).toBeLessThan(0.05);
      previousZ = animator.pose.z;
      highest = Math.max(highest, animator.pose.y);
      forwardmost = Math.min(forwardmost, animator.pose.z);
    }
    expect(highest).toBeGreaterThan(0.03);
    expect(forwardmost).toBeLessThan(-0.15);
    expect(animator.pose.y).toBeLessThan(-0.15); // the hand is down and away at the end
  });

  it('after a throw the weapon is drawn again, with no switch event', () => {
    const events = new EventBus<WeaponEvents>();
    let switched = 0;
    events.on('weapon:switched', () => switched++);
    const set = new WeaponSet(events, new Gun(events, 'rifle', rifleConfig, true, () => 0.999), new Gun(events, 'pistol', pistolConfig, false, () => 0.999), new Knife(events));
    expect(set.drawProgress).toBe(1);
    set.redraw();
    expect(set.drawing).toBe(true);
    expect(set.drawProgress).toBe(0);
    const none = { select: null, wheelSteps: 0, triggerHeld: false, triggerPressed: false, reloadPressed: false, checkRequested: false, canFire: true };
    for (let i = 0; i < 60; i++) set.update(dtSec, none);
    expect(set.drawProgress).toBe(1);
    expect(switched).toBe(0);
  });

  it('keeps the animation numbers in range', () => {
    expect(viewmodelConfigDefaults.drawLowerM).toBeGreaterThan(0);
  });
});

// Random play: presses of G mixed with everything else. Grenades are never more than were thrown, the count stays in range,
// and every blast comes from a throw.
describe('grenade random play', () => {
  it('keeps its counts honest whatever is pressed', () => {
    let seed = 2468;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const collision = level([wallAtX3]);
    for (let game = 0; game < 10; game++) {
      const events = new EventBus<WeaponEvents>();
      const camera = new PerspectiveCamera();
      camera.position.set(0, 1.6, 0);
      camera.rotation.y = (random() - 0.5) * 3;
      const target: BlastTarget = { chest: (out) => out.set(0, 1, 0), vulnerable: () => true, hurt: () => {} };
      const system = new GrenadeSystem(new Scene(), events, collision, camera, [], target);
      const thrower = new GrenadeThrower(events, 2);
      let thrown = 0;
      let exploded = 0;
      events.on('grenade:thrown', () => thrown++);
      events.on('grenade:exploded', () => exploded++);
      for (let tick = 0; tick < 6000; tick++) {
        if (random() < 0.01) thrower.give(1);
        thrower.update(dtSec, { pressed: random() < 0.03, canThrow: random() < 0.9 });
        system.update(dtSec);
        if (thrower.count < 0 || thrower.count > grenadeConfig.carryLimit) throw new Error('count out of range');
        if (exploded > thrown) throw new Error('a blast without a throw');
        if (system.live > thrown - exploded) throw new Error('more live grenades than were thrown');
      }
    }
  });

  it('panel defaults stay inside sensible values', () => {
    expect(grenadeConfigDefaults.carryLimit).toBe(2);
    expect(grenadeConfigDefaults.damageAtCentre).toBeGreaterThan(grenadeConfigDefaults.damageAtEdge);
  });
});
