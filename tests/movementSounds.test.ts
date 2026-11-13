import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementSounds } from '../src/audio/movementSounds';
import type { SoundName } from '../src/audio/recipes';
import type { PlayOptions, SoundPlayer } from '../src/audio/soundPlayer';
import { healthConfig } from '../src/config/health';
import { landingLoudness, movementConfig, movementConfigDefaults } from '../src/config/movement';
import { noiseConfig } from '../src/config/noise';
import { EventBus } from '../src/core/events';
import { Input } from '../src/core/input';
import { greyboxFloors, greyboxRoom } from '../src/data/greyboxRoom';
import { movementFolder } from '../src/debug/tuning';
import { buildGreybox } from '../src/level/greybox';
import { surfaceAt } from '../src/level/surfaces';
import { MovementReporter } from '../src/player/movementReporter';
import { Player } from '../src/player/player';
import { NoiseReporter } from '../src/stealth/noiseReporter';
import type { Noise } from '../src/stealth/noise';
import type { WeaponEvents } from '../src/weapons/events';

const dt = 1 / 60;
const { collision } = buildGreybox(greyboxRoom);

describe('surfaceAt', () => {
  it('is concrete on the open floor, tile and metal on their patches', () => {
    expect(surfaceAt(0, 0, 4.5)).toBe('concrete');
    const [tile, metal] = greyboxFloors;
    expect(surfaceAt(tile.xM, 0, tile.zM)).toBe('tile');
    expect(surfaceAt(metal.xM, 0, metal.zM)).toBe('metal');
    expect(surfaceAt(tile.xM + tile.widthM, 0, tile.zM)).toBe('concrete'); // just off the patch
  });

  it('is metal on top of a prop or a platform, whatever the floor below is', () => {
    expect(surfaceAt(-4, 1.0, -2)).toBe('metal'); // the low crate
    expect(surfaceAt(-2, 1.9, -4)).toBe('metal'); // the 1.9 m platform
    expect(surfaceAt(-2.65, 3.8, -4)).toBe('metal'); // the stacked one
  });

  it('uses a box surface when it has one', () => {
    const boxes = [{ kind: 'prop' as const, xM: 0, zM: 0, widthM: 2, depthM: 2, heightM: 1, surface: 'tile' as const }];
    expect(surfaceAt(0, 1, 0, boxes, [])).toBe('tile');
  });
});

describe('MovementReporter', () => {
  function setup(x: number, z: number) {
    const events = new EventBus<WeaponEvents>();
    const player = new Player(collision);
    player.position.set(x, 0, z);
    const reporter = new MovementReporter(events, player, surfaceAt);
    const input = new Input();
    input.enabled = true;
    const log: WeaponEvents['player:step'][] = [];
    const other: string[] = [];
    events.on('player:step', (e) => log.push(e));
    events.on('player:slid', () => other.push('slid'));
    events.on('player:mantled', ({ kind }) => other.push(kind));
    events.on('player:landed', () => other.push('landed'));
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        player.fixedUpdate(dt, input);
        reporter.update();
      }
    };
    player.onLanded = (speed) => reporter.landed(speed);
    return { events, player, reporter, input, log, other, run };
  }

  it('makes no step while standing still', () => {
    const { log, run } = setup(2, 5);
    run(2);
    expect(log).toHaveLength(0);
  });

  it('steps once per stride walked, the first only after a full stride, alternating feet', () => {
    const { player, input, log, run } = setup(2, 5.5);
    input.keyDown('KeyW');
    run(0.1);
    expect(log).toHaveLength(0);
    run(1.4);
    const distance = Math.abs(player.position.z - 5.5);
    expect(log.length).toBe(Math.floor(distance / movementConfigDefaults.stepEveryWalkM));
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.every((s) => s.kind === 'walk')).toBe(true);
    log.forEach((s, i) => expect(s.foot).toBe(i % 2 === 0 ? 1 : 0));
  });

  it('crouching steps are reported as crouch, and sprinting as sprint', () => {
    const crouch = setup(2, 5.5);
    crouch.input.keyDown('KeyW');
    crouch.input.keyDown('KeyC');
    crouch.run(1.8);
    expect(crouch.log.length).toBeGreaterThanOrEqual(2);
    expect(crouch.log.every((s) => s.kind === 'crouch')).toBe(true);

    const sprint = setup(2, 5.8);
    sprint.input.keyDown('KeyW');
    sprint.input.keyDown('ShiftLeft');
    sprint.run(1);
    expect(sprint.log.some((s) => s.kind === 'sprint')).toBe(true);
  });

  it('reports the surface under the feet: the tile patch', () => {
    const { input, log, run } = setup(-5.5, 5.8);
    input.keyDown('KeyD'); // along the tile patch
    run(0.8);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].surface).toBe('tile');
  });

  it('a slide, a vault and a climb are each reported once at their start', () => {
    const slide = setup(2, 5.8);
    slide.input.keyDown('KeyW');
    slide.input.keyDown('ShiftLeft');
    slide.run(0.6);
    slide.input.keyDown('KeyC');
    slide.run(0.2);
    expect(slide.other.filter((o) => o === 'slid')).toHaveLength(1);

    const vault = setup(-4, -0.9); // facing the low crate
    vault.input.keyDown('Space');
    vault.input.keyUp('Space');
    vault.run(1);
    expect(vault.other.filter((o) => o === 'vault')).toHaveLength(1);
    expect(vault.other).not.toContain('climb');

    const climb = setup(-2, -2.3); // facing the 1.9 m platform
    climb.input.keyDown('Space');
    climb.run(1.5);
    expect(climb.other.filter((o) => o === 'climb')).toHaveLength(1);
  });

  it('reports a landing with its speed, but not a landing too soft to hear', () => {
    const high = setup(0, 4.5);
    high.player.position.set(0, 3.8, 4.5);
    high.player.grounded = false;
    high.run(2);
    expect(high.other).toEqual(['landed']);

    const low = setup(0, 4.5);
    low.reporter.landed(movementConfig.landMinSpeedMps - 0.1);
    expect(low.other).toEqual([]);
  });
});

describe('MovementSounds', () => {
  function setup() {
    const events = new EventBus<WeaponEvents>();
    const played: { name: SoundName; options?: PlayOptions }[] = [];
    const player: SoundPlayer = { play: (name, options) => void played.push({ name, options }) };
    new MovementSounds(events, player, () => 0.5);
    return { events, played };
  }
  const here = new Vector3(1, 0, 2);

  it('plays the footstep of the surface, from the feet, with the left and right foot pitched apart', () => {
    const { events, played } = setup();
    for (const surface of ['concrete', 'metal', 'tile'] as const) events.emit('player:step', { kind: 'walk', surface, foot: 0, position: here });
    events.emit('player:step', { kind: 'walk', surface: 'concrete', foot: 1, position: here });
    expect(played.map((p) => p.name)).toEqual(['step-concrete', 'step-metal', 'step-tile', 'step-concrete']);
    expect(played[0].options?.position).toBe(here);
    expect(played[3].options!.rate!).toBeGreaterThan(played[0].options!.rate!);
  });

  it('crouching is quieter than walking, and sprinting louder', () => {
    const { events, played } = setup();
    for (const kind of ['crouch', 'walk', 'sprint'] as const) events.emit('player:step', { kind, surface: 'concrete', foot: 0, position: here });
    const [crouch, walk, sprint] = played.map((p) => p.options!.volume!);
    expect(crouch).toBeLessThan(walk);
    expect(walk).toBeLessThan(sprint);
  });

  it('plays the slide, the vault and the climb', () => {
    const { events, played } = setup();
    events.emit('player:slid', { surface: 'concrete', position: here });
    events.emit('player:mantled', { kind: 'vault', position: here });
    events.emit('player:mantled', { kind: 'climb', position: here });
    expect(played.map((p) => p.name)).toEqual(['slide', 'vault', 'climb']);
  });

  it('a soft landing is quiet and grows with the fall; a hard one (that also hurts) is the heavy sound at full volume', () => {
    const { events, played } = setup();
    const land = (speedMps: number) => events.emit('player:landed', { speedMps, surface: 'concrete', position: here });
    land(movementConfig.landMinSpeedMps);
    land(healthConfig.fallSafeSpeedMps - 0.5);
    land(healthConfig.fallSafeSpeedMps + 2);
    expect(played.map((p) => p.name)).toEqual(['land-soft', 'land-soft', 'land-hard']);
    expect(played[0].options!.volume).toBeCloseTo(movementConfig.landSoftMinVolume);
    expect(played[1].options!.volume!).toBeGreaterThan(played[0].options!.volume!);
    expect(played[2].options!.volume).toBe(1);
  });
});

describe('landingLoudness', () => {
  it('goes from 0 to 1 between the quietest heard landing and the safe landing speed', () => {
    expect(landingLoudness(movementConfig.landMinSpeedMps)).toBe(0);
    expect(landingLoudness(healthConfig.fallSafeSpeedMps)).toBe(1);
    expect(landingLoudness(100)).toBe(1);
    expect(landingLoudness(7)).toBeGreaterThan(0);
  });
});

describe('what enemies hear of the player moving', () => {
  it('crouching is close to silent, sprinting is loud, and a harder landing carries further', () => {
    const events = new EventBus<WeaponEvents>();
    const noises: Noise[] = [];
    events.on('noise:made', (n) => noises.push(n));
    new NoiseReporter(events, () => new Vector3());
    const here = new Vector3(1, 0, 2);
    for (const kind of ['crouch', 'walk', 'sprint'] as const) events.emit('player:step', { kind, surface: 'concrete', foot: 0, position: here });
    events.emit('player:slid', { surface: 'concrete', position: here });
    events.emit('player:mantled', { kind: 'vault', position: here });
    events.emit('player:mantled', { kind: 'climb', position: here });
    events.emit('player:landed', { speedMps: movementConfig.landMinSpeedMps, surface: 'concrete', position: here });
    events.emit('player:landed', { speedMps: healthConfig.fallSafeSpeedMps + 3, surface: 'concrete', position: here });
    const [crouch, walk, sprint, slide, vault, climb, softLanding, hardLanding] = noises;
    expect([crouch.kind, walk.kind, sprint.kind]).toEqual(['footstep', 'footstep', 'footstep']);
    expect(crouch.radiusM).toBe(noiseConfig.crouchStepM);
    expect(walk.radiusM).toBe(noiseConfig.walkStepM);
    expect(sprint.radiusM).toBe(noiseConfig.sprintStepM);
    expect(crouch.radiusM).toBeLessThan(walk.radiusM);
    expect(walk.radiusM).toBeLessThan(sprint.radiusM);
    expect([slide.kind, vault.kind, climb.kind]).toEqual(['slide', 'vault', 'climb']);
    expect(softLanding.kind).toBe('landing');
    expect(softLanding.radiusM).toBeCloseTo(noiseConfig.landingSoftM);
    expect(hardLanding.radiusM).toBeCloseTo(noiseConfig.landingHardM);
    expect(noises[0].position).not.toBe(here); // a copy: the vectors passed around are reused
  });
});

describe('the movement tuning panel', () => {
  it('lists every movement value once, with a sensible range around its default', () => {
    for (const s of movementFolder.sliders) {
      expect(s.min).toBeLessThan(s.max);
      expect(movementConfigDefaults[s.key], s.key).toBeGreaterThanOrEqual(s.min);
      expect(movementConfigDefaults[s.key], s.key).toBeLessThanOrEqual(s.max);
    }
    const keys = movementFolder.sliders.map((s) => s.key as string);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of Object.keys(movementConfigDefaults)) expect(keys, `${key} is not on the panel`).toContain(key);
  });
});
