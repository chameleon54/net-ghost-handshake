import { describe, expect, it } from 'vitest';
import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { audioConfig, audioConfigDefaults } from '../src/config/audio';
import { pistolConfigDefaults } from '../src/config/pistol';
import { rifleConfigDefaults } from '../src/config/rifle';
import { WeaponSounds } from '../src/audio/weaponSounds';
import { makeSound, recipes, soundNames, type SoundName } from '../src/audio/recipes';
import { parseSoundFile } from '../src/audio/soundFiles';
import type { PlayOptions, SoundPlayer } from '../src/audio/soundPlayer';
import { createRng, energyOf, peakOf, seedFromText } from '../src/audio/synth';
import { EventBus } from '../src/core/events';
import { Casings } from '../src/fx/casings';
import { buildGreybox } from '../src/level/greybox';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun, type GunInput } from '../src/weapons/gun';

const sampleRate = 44100;
const dtSec = 1 / 60;

describe('the built-in sounds', () => {
  const everySound = soundNames.flatMap((name) => Array.from({ length: recipes[name].variants }, (_, variant) => ({ name, variant })));

  it('has a recipe for every name, with at least one version', () => {
    for (const name of soundNames) expect(recipes[name].variants, name).toBeGreaterThanOrEqual(1);
  });

  it('every version is audible, finite, never louder than full scale, and ends in silence', () => {
    for (const { name, variant } of everySound) {
      const samples = makeSound(name, variant, sampleRate);
      expect(samples.length, name).toBeGreaterThan(sampleRate * 0.03);
      expect(samples.every(Number.isFinite), name).toBe(true);
      const peak = peakOf(samples);
      expect(peak, `${name} peak`).toBeGreaterThan(0.2);
      expect(peak, `${name} peak`).toBeLessThanOrEqual(1);
      expect(Math.abs(samples[samples.length - 1]), `${name} end`).toBeLessThan(0.01); // no click at the end
    }
  });

  it('the same name and version always make the same sound; versions of one name differ', () => {
    for (const name of ['rifle-fire', 'impact', 'casing-clink'] as const) {
      expect(makeSound(name, 0, sampleRate)).toEqual(makeSound(name, 0, sampleRate));
      expect(makeSound(name, 0, sampleRate)).not.toEqual(makeSound(name, 1, sampleRate));
    }
  });

  it('a rifle shot is punchier and louder than a suppressed pistol shot', () => {
    const rifle = makeSound('rifle-fire', 0, sampleRate);
    const pistol = makeSound('pistol-fire', 0, sampleRate);
    expect(energyOf(rifle, sampleRate, 0.1)).toBeGreaterThan(energyOf(pistol, sampleRate, 0.1) * 1.3);
    expect(rifle.length).toBeGreaterThan(pistol.length); // and it rings on longer
  });

  it('the dry click, the jam clunk and the jam click are three different sounds', () => {
    const [dry, clunk, jamClick] = (['dry-click', 'jam-clunk', 'jam-click'] as const).map((name) => makeSound(name, 0, sampleRate));
    expect(dry).not.toEqual(clunk);
    expect(clunk).not.toEqual(jamClick);
    expect(dry).not.toEqual(jamClick);
    // The jam sounds are duller: a clunk has far more of its energy in the first moments than a high tick does.
    expect(energyOf(clunk, sampleRate, 0.1)).toBeGreaterThan(energyOf(dry, sampleRate, 0.1));
  });

  it('every tap that clears a jam has its own sound', () => {
    const taps = (['rack-tap-1', 'rack-tap-2', 'rack-tap-3', 'rack-final'] as const).map((name) => makeSound(name, 0, sampleRate));
    for (let a = 0; a < taps.length; a++) for (let b = a + 1; b < taps.length; b++) expect(taps[a]).not.toEqual(taps[b]);
  });

  it('rng and seeds are repeatable', () => {
    expect(createRng(5)()).toBe(createRng(5)());
    expect(createRng(5)()).not.toBe(createRng(6)());
    expect(seedFromText('rifle-fire#0')).not.toBe(seedFromText('rifle-fire#1'));
  });
});

describe('parseSoundFile', () => {
  it('reads a name with and without a version number', () => {
    expect(parseSoundFile('../assets/audio/sfx-rifle-fire-01.ogg')).toEqual({ name: 'rifle-fire', variant: 1 });
    expect(parseSoundFile('../assets/audio/sfx-rifle-fire-03.ogg')).toEqual({ name: 'rifle-fire', variant: 3 });
    expect(parseSoundFile('../assets/audio/sfx-dry-click.ogg')).toEqual({ name: 'dry-click', variant: 1 });
  });

  it('understands names that end in a number themselves', () => {
    expect(parseSoundFile('sfx-rack-tap-1.ogg')).toEqual({ name: 'rack-tap-1', variant: 1 });
    expect(parseSoundFile('sfx-rack-tap-2-02.ogg')).toEqual({ name: 'rack-tap-2', variant: 2 });
  });

  it('ignores files that do not follow the naming or name no known sound', () => {
    expect(parseSoundFile('rifle-fire.ogg')).toBeNull();
    expect(parseSoundFile('sfx-rifle-fire.mp3')).toBeNull();
    expect(parseSoundFile('sfx-unknown-sound.ogg')).toBeNull();
    expect(parseSoundFile('')).toBeNull();
  });
});

// A fake sound player that remembers what it was asked to play.
class FakePlayer implements SoundPlayer {
  played: { name: SoundName; options: PlayOptions }[] = [];
  play(name: SoundName, options: PlayOptions = {}): void {
    this.played.push({ name, options: { ...options, position: options.position?.clone() } });
  }
  get names(): SoundName[] {
    return this.played.map((p) => p.name);
  }
}

describe('WeaponSounds', () => {
  const setup = () => {
    const events = new EventBus<WeaponEvents>();
    const player = new FakePlayer();
    const sounds = new WeaponSounds(events, player, () => 0.5); // 0.5 means no pitch change
    return { events, player, sounds };
  };
  const wait = (sounds: WeaponSounds, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dtSec); i++) sounds.update(dtSec);
  };

  it('a rifle shot is loud; a pistol shot is the same kind of sound at about half the volume, never silent', () => {
    const { events, player } = setup();
    events.emit('weapon:fired', { weapon: 'rifle', heat: 0 });
    events.emit('weapon:fired', { weapon: 'pistol', heat: 0 });
    expect(player.names).toEqual(['rifle-fire', 'pistol-fire']);
    expect(player.played[0].options.volume).toBe(1);
    expect(player.played[1].options.volume).toBe(audioConfig.pistolLoudness);
    expect(player.played[1].options.volume).toBeGreaterThan(0);
  });

  it('a hot rifle adds a rattle that gets louder with heat; a cool one, and the pistol, do not', () => {
    const { events, player } = setup();
    events.emit('weapon:fired', { weapon: 'rifle', heat: audioConfigDefaults.rattleStartHeat - 1 });
    expect(player.names).toEqual(['rifle-fire']);
    events.emit('weapon:fired', { weapon: 'rifle', heat: 85 });
    events.emit('weapon:fired', { weapon: 'rifle', heat: 100 });
    const rattles = player.played.filter((p) => p.name === 'fire-rattle').map((p) => p.options.volume!);
    expect(rattles).toHaveLength(2);
    expect(rattles[1]).toBeGreaterThan(rattles[0]);
    expect(rattles[1]).toBeCloseTo(1);
    events.emit('weapon:fired', { weapon: 'pistol', heat: 100 });
    expect(player.played.filter((p) => p.name === 'fire-rattle')).toHaveLength(2);
  });

  it('the empty click, a jam, and a jammed trigger pull each have their own sound', () => {
    const { events, player } = setup();
    events.emit('weapon:empty-click', undefined);
    events.emit('weapon:jammed', { weapon: 'rifle' });
    events.emit('weapon:jam-click', { weapon: 'rifle' });
    expect(player.names).toEqual(['dry-click', 'jam-clunk', 'jam-click']);
  });

  it('each tap that clears a jam has its own sound, and the last is the ejection (rifle four taps, pistol two)', () => {
    const { events, player } = setup();
    for (let tap = 1; tap <= 4; tap++) events.emit('weapon:rack', { weapon: 'rifle', tap, taps: 4 });
    for (let tap = 1; tap <= 2; tap++) events.emit('weapon:rack', { weapon: 'pistol', tap, taps: 2 });
    expect(player.names).toEqual(['rack-tap-1', 'rack-tap-2', 'rack-tap-3', 'rack-final', 'rack-tap-1', 'rack-final']);
  });

  it('a reload plays the magazine out and in at the moments the animation shows them, scaled to its length', () => {
    const { events, player, sounds } = setup();
    events.emit('weapon:reload-started', { weapon: 'rifle', durationSec: 2, rackShare: 0 });
    wait(sounds, 0.3);
    expect(player.names).toEqual([]);
    wait(sounds, 0.2); // 0.5 s: past the magazine coming out (20% of 2 s = 0.4 s)
    expect(player.names).toEqual(['mag-out']);
    wait(sounds, 1.0); // 1.5 s: still before it goes in (82% = 1.64 s)
    expect(player.names).toEqual(['mag-out']);
    wait(sounds, 0.3);
    expect(player.names).toEqual(['mag-out', 'mag-in']);
  });

  it('an empty reload adds the rack: a pull, then the slide snapping forward, near the end', () => {
    const { events, player, sounds } = setup();
    events.emit('weapon:reload-started', { weapon: 'rifle', durationSec: 2.2, rackShare: 0.2 / 2.2 });
    wait(sounds, 2.3);
    expect(player.names).toEqual(['mag-out', 'mag-in', 'rack-tap-1', 'slide-release']);
  });

  it('switching weapon cancels the sounds still to come from a reload, and plays the new weapon being drawn', () => {
    const { events, player, sounds } = setup();
    events.emit('weapon:reload-started', { weapon: 'rifle', durationSec: 2, rackShare: 0 });
    wait(sounds, 0.2);
    events.emit('weapon:switched', { weapon: 'pistol' });
    wait(sounds, 3);
    expect(player.names).toEqual(['draw-pistol']);
  });

  it('an interrupted check drops its remaining sounds', () => {
    const { events, player, sounds } = setup();
    events.emit('weapon:check-started', { weapon: 'rifle', durationSec: 1 });
    wait(sounds, 0.3);
    expect(player.names).toEqual(['check-out']);
    events.emit('weapon:interrupted', { weapon: 'rifle' });
    wait(sounds, 2);
    expect(player.names).toEqual(['check-out']);
  });

  it('an inspect plays its sounds, but firing ends it and its later sounds', () => {
    const { events, player, sounds } = setup();
    events.emit('weapon:inspect-started', { weapon: 'rifle', durationSec: 2.6 });
    wait(sounds, 2.6);
    expect(player.names).toEqual(['inspect-clack', 'slide-release']);

    const second = setup();
    second.events.emit('weapon:inspect-started', { weapon: 'pistol', durationSec: 2.6 });
    wait(second.sounds, 0.5);
    second.events.emit('weapon:fired', { weapon: 'pistol', heat: 0 });
    wait(second.sounds, 3);
    expect(second.player.names).toEqual(['pistol-fire']);
  });

  it('the knife has its own draw, swing and stab, and its inspect is a flip', () => {
    const { events, player, sounds } = setup();
    events.emit('weapon:switched', { weapon: 'knife' });
    events.emit('weapon:swing', undefined);
    events.emit('target:hit', { zone: 'body', killed: false, weapon: 'knife' });
    expect(player.names).toEqual(['draw-knife', 'knife-swing', 'knife-stab', 'hit-tick']);
    events.emit('weapon:inspect-started', { weapon: 'knife', durationSec: 1.6 });
    wait(sounds, 1.7);
    expect(player.names.slice(4)).toEqual(['knife-swing', 'draw-knife']);
  });

  it('a hit ticks, a kill ticks differently', () => {
    const { events, player } = setup();
    events.emit('target:hit', { zone: 'body', killed: false, weapon: 'rifle' });
    events.emit('target:hit', { zone: 'head', killed: true, weapon: 'rifle' });
    expect(player.names).toEqual(['hit-tick', 'kill-tick']);
  });

  it('a bullet landing in a wall makes an impact at that spot, and one that hit a target does not', () => {
    const { events, player } = setup();
    const end = new Vector3(3, 1, -4);
    events.emit('shot:landed', { muzzle: new Vector3(), end, hit: true, normal: new Vector3(0, 0, 1), shooter: 'player' });
    events.emit('shot:landed', { muzzle: new Vector3(), end, hit: false, normal: new Vector3(), shooter: 'player' });
    expect(player.names).toEqual(['impact']);
    expect(player.played[0].options.position?.toArray()).toEqual([3, 1, -4]);
  });

  it('casing clinks are positional, louder when faster, and not more often than the minimum gap', () => {
    const { events, player, sounds } = setup();
    const position = new Vector3(1, 0, 1);
    events.emit('casing:bounced', { position, speedMps: 0.5 });
    events.emit('casing:bounced', { position, speedMps: 5 }); // too soon after the first: dropped
    expect(player.names).toEqual(['casing-clink']);
    wait(sounds, audioConfig.casingClinkMinGapSec + 0.05);
    events.emit('casing:bounced', { position, speedMps: 5 });
    expect(player.names).toEqual(['casing-clink', 'casing-clink']);
    expect(player.played[1].options.volume!).toBeGreaterThan(player.played[0].options.volume!);
    expect(player.played[0].options.position).toBeDefined();
  });

  it('plays a little off the normal pitch when the random number says so, and never outside the variation', () => {
    const events = new EventBus<WeaponEvents>();
    const player = new FakePlayer();
    new WeaponSounds(events, player, () => 1);
    events.emit('weapon:empty-click', undefined);
    expect(player.played[0].options.rate).toBeCloseTo(1 + audioConfig.pitchVariation);
  });
});

describe('the events that carry sound information', () => {
  const go: GunInput = { triggerHeld: true, triggerPressed: true, reloadPressed: false, checkRequested: false, canFire: true };
  const idle: GunInput = { ...go, triggerHeld: false, triggerPressed: false };

  it('a shot carries the gun heat', () => {
    const events = new EventBus<WeaponEvents>();
    const heats: number[] = [];
    events.on('weapon:fired', ({ heat }) => heats.push(heat));
    const gun = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true, () => 0.999);
    for (let i = 0; i < 30; i++) gun.update(dtSec, go);
    expect(heats.length).toBeGreaterThan(3);
    expect(heats[heats.length - 1]).toBeGreaterThan(heats[0]);
  });

  it('a reload says how long it is and how much of it is the rack; a check says how long it is', () => {
    const events = new EventBus<WeaponEvents>();
    const reloads: WeaponEvents['weapon:reload-started'][] = [];
    const checks: WeaponEvents['weapon:check-started'][] = [];
    events.on('weapon:reload-started', (e) => reloads.push(e));
    events.on('weapon:check-started', (e) => checks.push(e));
    const gun = new Gun(events, 'pistol', { ...pistolConfigDefaults }, false, () => 0.999);
    gun.update(dtSec, go);
    gun.update(dtSec, { ...idle, reloadPressed: true });
    expect(reloads[0].durationSec).toBeCloseTo(pistolConfigDefaults.reloadTimeSec);
    expect(reloads[0].rackShare).toBe(0);
    for (let i = 0; i < 120; i++) gun.update(dtSec, idle);
    gun.update(dtSec, { ...idle, checkRequested: true });
    expect(checks[0].durationSec).toBeCloseTo(pistolConfigDefaults.checkMagazineSec);
  });

  it('interrupting a reload or a check says so; interrupting nothing does not', () => {
    const events = new EventBus<WeaponEvents>();
    let interrupted = 0;
    events.on('weapon:interrupted', () => interrupted++);
    const gun = new Gun(events, 'rifle', { ...rifleConfigDefaults }, true, () => 0.999);
    gun.interrupt();
    expect(interrupted).toBe(0);
    gun.update(dtSec, go);
    gun.update(dtSec, { ...idle, reloadPressed: true });
    gun.interrupt();
    expect(interrupted).toBe(1);
  });

  it('a casing that bounces says how hard', () => {
    const { collision } = buildGreybox([{ kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 }]);
    const events = new EventBus<WeaponEvents>();
    const speeds: number[] = [];
    events.on('casing:bounced', ({ speedMps }) => speeds.push(speedMps));
    const casings = new Casings(new Scene(), events, collision, new PerspectiveCamera(), { rifle: new Vector3(), pistol: new Vector3() });
    casings.spawn(new Vector3(0, 1, 0), new Vector3(0, 0, 0));
    for (let i = 0; i < 180; i++) casings.update(dtSec);
    expect(speeds.length).toBeGreaterThanOrEqual(1);
    expect(speeds[0]).toBeGreaterThan(3); // it fell 1 m: about 4.4 m/s into the floor
    expect(speeds[speeds.length - 1]).toBeLessThan(speeds[0]); // and each bounce is softer
  });
});
