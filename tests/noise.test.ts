import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { noiseConfig, noiseConfigDefaults } from '../src/config/noise';
import { pistolConfig } from '../src/config/pistol';
import { rifleConfig } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import { buildGreybox } from '../src/level/greybox';
import { hearsNoise, type Noise } from '../src/stealth/noise';
import { NoiseReporter } from '../src/stealth/noiseReporter';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun, type GunInput } from '../src/weapons/gun';
import { Shooter } from '../src/weapons/shooter';

const dtSec = 1 / 60;

describe('hearsNoise', () => {
  const noise: Noise = { kind: 'rifle-shot', position: new Vector3(0, 0, 0), radiusM: 10 };

  it('is heard inside the radius, at the edge, and not beyond it', () => {
    expect(hearsNoise(noise, new Vector3(3, 0, 4))).toBe(true); // 5 m
    expect(hearsNoise(noise, new Vector3(10, 0, 0))).toBe(true); // exactly at the edge
    expect(hearsNoise(noise, new Vector3(10.1, 0, 0))).toBe(false);
    expect(hearsNoise(noise, new Vector3(0, 0, -30))).toBe(false);
  });
});

describe('NoiseReporter', () => {
  const setup = () => {
    const events = new EventBus<WeaponEvents>();
    const player = new Vector3(1, 1.6, 2);
    new NoiseReporter(events, () => player);
    const noises: Noise[] = [];
    events.on('noise:made', (n) => noises.push(n));
    return { events, noises, player };
  };

  it('an M4-A shot is loud and a suppressed P9 shot is heard only close by', () => {
    const { events, noises } = setup();
    events.emit('weapon:fired', { weapon: 'rifle', heat: 0 });
    events.emit('weapon:fired', { weapon: 'pistol', heat: 0 });
    expect(noises.map((n) => n.kind)).toEqual(['rifle-shot', 'pistol-shot']);
    expect(noises[0].radiusM).toBe(noiseConfig.rifleShotM);
    expect(noises[1].radiusM).toBe(noiseConfig.pistolShotM);
    expect(noises[1].radiusM).toBeLessThan(noises[0].radiusM / 4);
    expect(noises[0].position.toArray()).toEqual([1, 1.6, 2]);
  });

  it('an enemy 4 m away hears the P9 and one 8 m away does not, while both hear the M4-A', () => {
    const { events, noises } = setup();
    events.emit('weapon:fired', { weapon: 'pistol', heat: 0 });
    events.emit('weapon:fired', { weapon: 'rifle', heat: 0 });
    const [pistol, rifle] = noises;
    const near = new Vector3(1, 1.6, 6); // 4 m from the player
    const further = new Vector3(1, 1.6, 10); // 8 m
    expect(hearsNoise(pistol, near)).toBe(true);
    expect(hearsNoise(pistol, further)).toBe(false);
    expect(hearsNoise(rifle, near)).toBe(true);
    expect(hearsNoise(rifle, further)).toBe(true);
    expect(hearsNoise(rifle, new Vector3(1, 1.6, 30))).toBe(true); // across a room or two
  });

  it('a bullet hitting a surface is loud, wherever it lands, and one that hit a target is not', () => {
    const { events, noises } = setup();
    const end = new Vector3(5, 1, -12);
    events.emit('shot:landed', { muzzle: new Vector3(), end, hit: true, normal: new Vector3(0, 0, 1) });
    events.emit('shot:landed', { muzzle: new Vector3(), end, hit: false, normal: new Vector3() });
    expect(noises).toHaveLength(1);
    expect(noises[0].kind).toBe('impact');
    expect(noises[0].radiusM).toBe(noiseConfig.impactM);
    expect(noises[0].position.toArray()).toEqual([5, 1, -12]);
  });

  it('keeps the position as a copy, so a vector that is reused later cannot change an old noise', () => {
    const { events, noises } = setup();
    const end = new Vector3(5, 1, -12);
    events.emit('shot:landed', { muzzle: new Vector3(), end, hit: true, normal: new Vector3(0, 0, 1) });
    end.set(99, 99, 99);
    expect(noises[0].position.toArray()).toEqual([5, 1, -12]);
  });

  it('the empty click, a reload, a jam and its clicks and racks each make their noise at the player', () => {
    const { events, noises } = setup();
    events.emit('weapon:empty-click', undefined);
    events.emit('weapon:reload-started', { weapon: 'rifle', durationSec: 1.8, rackShare: 0 });
    events.emit('weapon:jammed', { weapon: 'rifle' });
    events.emit('weapon:jam-click', { weapon: 'rifle' });
    events.emit('weapon:rack', { weapon: 'rifle', tap: 1, taps: 4 });
    expect(noises.map((n) => [n.kind, n.radiusM])).toEqual([
      ['empty-click', noiseConfig.emptyClickM],
      ['reload', noiseConfig.reloadM],
      ['jam', noiseConfig.jamM],
      ['jam-click', noiseConfig.jamClickM],
      ['rack', noiseConfig.rackM],
    ]);
    for (const n of noises) expect(n.position.toArray()).toEqual([1, 1.6, 2]);
  });

  it('the knife is quiet: a short swing and a slightly louder stab, far less than a gun', () => {
    const { events, noises } = setup();
    events.emit('weapon:swing', undefined);
    events.emit('target:hit', { zone: 'body', killed: false, weapon: 'knife' });
    events.emit('target:hit', { zone: 'body', killed: false, weapon: 'rifle' }); // a bullet hit is not a stab
    expect(noises.map((n) => n.kind)).toEqual(['knife-swing', 'knife-stab']);
    expect(noises[1].radiusM).toBeLessThan(noiseConfig.pistolShotM);
  });

  it('a grenade makes noise where it bounces and a huge one where it goes off', () => {
    const { events, noises } = setup();
    events.emit('grenade:bounced', { position: new Vector3(3, 0, -5), speedMps: 4 });
    events.emit('grenade:exploded', { position: new Vector3(4, 0, -9), radiusM: 5 });
    expect(noises.map((n) => n.kind)).toEqual(['grenade-bounce', 'grenade-blast']);
    expect(noises[0].position.toArray()).toEqual([3, 0, -5]);
    expect(noises[1].position.toArray()).toEqual([4, 0, -9]);
    expect(noises[1].radiusM).toBe(noiseConfig.grenadeBlastM);
    expect(noises[1].radiusM).toBeGreaterThan(noiseConfig.rifleShotM);
  });

  it('things the player does silently make no noise: checking, inspecting, drawing, switching', () => {
    const { events, noises } = setup();
    events.emit('weapon:check-started', { weapon: 'rifle', durationSec: 1 });
    events.emit('weapon:inspect-started', { weapon: 'rifle', durationSec: 2.6 });
    events.emit('weapon:switched', { weapon: 'pistol' });
    events.emit('weapon:interrupted', { weapon: 'rifle' });
    events.emit('weapon:reloaded', undefined);
    events.emit('grenade:pin', undefined);
    expect(noises).toHaveLength(0);
  });

  it('follows the live radii: changing them in the panel changes the next noise', () => {
    const { events, noises } = setup();
    noiseConfig.pistolShotM = 12;
    try {
      events.emit('weapon:fired', { weapon: 'pistol', heat: 0 });
      expect(noises[0].radiusM).toBe(12);
    } finally {
      noiseConfig.pistolShotM = noiseConfigDefaults.pistolShotM;
    }
  });
});

describe('the P9 suppressor, end to end', () => {
  // A wall 12 m in front of the player. The player is at the origin looking down -z, so the wall face is at z -11.9.
  function setup() {
    const { collision } = buildGreybox([{ kind: 'wall', xM: 0, zM: -12, widthM: 30, depthM: 0.2, heightM: 5 }]);
    const events = new EventBus<WeaponEvents>();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 0);
    const muzzle = new Vector3();
    const configs = { rifle: { ...rifleConfig, hipSpreadRad: 0, aimedSpreadRad: 0 }, pistol: { ...pistolConfig, hipSpreadRad: 0, aimedSpreadRad: 0 } };
    new Shooter(events, collision, camera, { rifle: muzzle, pistol: muzzle }, [], configs);
    new NoiseReporter(events, () => camera.position);
    const noises: Noise[] = [];
    events.on('noise:made', (n) => noises.push(n));
    const pistol = new Gun(events, 'pistol', { ...pistolConfig }, false, () => 0.999);
    const rifle = new Gun(events, 'rifle', { ...rifleConfig }, true, () => 0.999);
    const click: GunInput = { triggerHeld: true, triggerPressed: true, reloadPressed: false, checkRequested: false, canFire: true };
    return { noises, pistol, rifle, click, camera };
  }

  it('a P9 shot at a wall: the shot is heard only close by, but the impact on the wall is loud', () => {
    const { noises, pistol, click } = setup();
    pistol.update(dtSec, click);
    expect(noises.map((n) => n.kind).sort()).toEqual(['impact', 'pistol-shot']); // both are announced (in either order)
    const shot = noises.find((n) => n.kind === 'pistol-shot')!;
    const impact = noises.find((n) => n.kind === 'impact')!;
    expect(shot.radiusM).toBe(noiseConfig.pistolShotM);
    expect(impact.radiusM).toBe(noiseConfig.impactM);
    expect(impact.position.z).toBeCloseTo(-11.9, 1); // where the bullet landed
    // A guard beside the wall, 3 m from the impact, hears it; a guard 8 m from the player does not hear the shot.
    const guardByWall = new Vector3(3, 1.6, -11.9);
    const guardFar = new Vector3(0, 1.6, -8);
    expect(hearsNoise(shot, guardByWall)).toBe(false);
    expect(hearsNoise(impact, guardByWall)).toBe(true);
    expect(hearsNoise(shot, guardFar)).toBe(false);
  });

  it('an M4-A shot at the same wall is heard across the room', () => {
    const { noises, rifle, click } = setup();
    rifle.update(dtSec, { ...click, triggerPressed: false });
    expect(noises.map((n) => n.kind).sort()).toEqual(['impact', 'rifle-shot']);
    const shot = noises.find((n) => n.kind === 'rifle-shot')!;
    expect(hearsNoise(shot, new Vector3(0, 1.6, -8))).toBe(true);
    expect(hearsNoise(shot, new Vector3(0, 1.6, -30))).toBe(true);
  });
});
