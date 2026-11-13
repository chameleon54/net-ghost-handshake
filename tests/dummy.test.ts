import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Ray, Vector3 } from 'three';
import { dummyConfigDefaults as d } from '../src/config/dummy';
import { pistolConfigDefaults } from '../src/config/pistol';
import { rifleConfigDefaults } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import { Dummy } from '../src/enemies/dummy';
import { createDummyHit, rayHitDummy } from '../src/enemies/dummyHit';
import { Health } from '../src/enemies/health';
import { buildGreybox } from '../src/level/greybox';
import type { WeaponEvents } from '../src/weapons/events';
import { Shooter } from '../src/weapons/shooter';

describe('Health', () => {
  it('takes damage, never goes below 0 and reports the killing hit once', () => {
    const h = new Health(30);
    expect(h.damage(20)).toBe(false);
    expect(h.damage(20)).toBe(true);
    expect(h.current).toBe(0);
    expect(h.damage(20)).toBe(false); // already dead
    expect(h.kill()).toBe(false);
  });

  it('kill takes everything at once', () => {
    const h = new Health(100);
    expect(h.kill()).toBe(true);
    expect(h.dead).toBe(true);
  });
});

describe('Dummy', () => {
  it('dies after enough body hits, falls, lies down, then stands up with full health', () => {
    const dummy = new Dummy(0, 0);
    const hits = Math.ceil(d.healthPoints / rifleConfigDefaults.bodyDamagePerHit);
    for (let i = 0; i < hits - 1; i++) expect(dummy.hit('body', rifleConfigDefaults.bodyDamagePerHit)).toBe(false);
    expect(dummy.hit('body', rifleConfigDefaults.bodyDamagePerHit)).toBe(true);
    expect(dummy.state).toBe('falling');
    expect(dummy.hit('head', 15)).toBe(false); // a falling dummy cannot be hit again
    dummy.update(d.fallTimeSec + 0.01);
    expect(dummy.state).toBe('down');
    expect(dummy.fallProgress).toBe(1);
    dummy.update(d.respawnDelaySec + 0.01);
    expect(dummy.state).toBe('standing');
    expect(dummy.health.current).toBe(d.healthPoints);
  });

  it('a headshot always kills, even with no damage and from full health', () => {
    const dummy = new Dummy(0, 0);
    expect(dummy.hit('head', 0)).toBe(true);
    expect(dummy.state).toBe('falling');
  });
});

describe('Dummy facing', () => {
  it('knows when an attacker is behind it', () => {
    const north = new Dummy(0, 0, 0); // faces -z
    expect(north.isBehind(0, 2)).toBe(true);
    expect(north.isBehind(0, -2)).toBe(false);
    const south = new Dummy(0, 0, Math.PI); // faces +z
    expect(south.isBehind(0, -2)).toBe(true);
    expect(south.isBehind(0, 2)).toBe(false);
    const east = new Dummy(0, 0, -Math.PI / 2); // faces +x
    expect(east.isBehind(-2, 0)).toBe(true);
    expect(east.isBehind(2, 0)).toBe(false);
  });

  it('kill() kills a standing dummy at once and does nothing to one that is down', () => {
    const dummy = new Dummy(0, 0);
    expect(dummy.kill()).toBe(true);
    expect(dummy.kill()).toBe(false);
  });
});

describe('rayHitDummy', () => {
  const dummy = new Dummy(0, -5);
  const headHeightM = d.heightM - d.headRadiusM;
  const out = createDummyHit();
  const shootAt = (y: number, x = 0) => {
    const origin = new Vector3(x, y, 0);
    return rayHitDummy(new Ray(origin, new Vector3(0, 0, -1)), dummy, 50, out);
  };

  it('hits the body at chest height, about 5 m minus half its depth away', () => {
    expect(shootAt(1.0)).toBe(true);
    expect(out.zone).toBe('body');
    expect(out.distanceM).toBeCloseTo(5 - d.bodyDepthM / 2);
  });

  it('hits the head at head height', () => {
    expect(shootAt(headHeightM)).toBe(true);
    expect(out.zone).toBe('head');
  });

  it('misses over the head, to the side, and behind the shooter', () => {
    expect(shootAt(d.heightM + 0.1)).toBe(false);
    expect(shootAt(1.0, 1)).toBe(false);
    expect(rayHitDummy(new Ray(new Vector3(0, 1, 0), new Vector3(0, 0, 1)), dummy, 50, out)).toBe(false);
  });

  it('misses beyond the maximum distance and when the dummy is down', () => {
    expect(rayHitDummy(new Ray(new Vector3(0, 1, 0), new Vector3(0, 0, -1)), dummy, 3, out)).toBe(false);
    const dead = new Dummy(0, -5);
    dead.hit('head', 0);
    expect(rayHitDummy(new Ray(new Vector3(0, 1, 0), new Vector3(0, 0, -1)), dead, 50, out)).toBe(false);
  });
});

describe('Shooter with dummies', () => {
  const noSpread = { hipSpreadRad: 0, aimedSpreadRad: 0 }; // so a test shot flies exactly where the camera points
  // A camera at eye height looking down -z. A wall 3 m ahead (z -3.15 to -2.85), a dummy 5 m ahead.
  function setup(withWall: boolean) {
    const { collision } = buildGreybox(withWall ? [{ kind: 'wall', xM: 0, zM: -3, widthM: 4, depthM: 0.3, heightM: 3 }] : [{ kind: 'wall', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 }]);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.0, 0);
    const events = new EventBus<WeaponEvents>();
    const dummy = new Dummy(0, -5);
    const muzzle = new Vector3();
    new Shooter(events, collision, camera, { rifle: muzzle, pistol: muzzle }, [dummy], { rifle: { ...rifleConfigDefaults, ...noSpread }, pistol: { ...pistolConfigDefaults, ...noSpread } });
    const hits: { zone: string; killed: boolean }[] = [];
    events.on('target:hit', (hit) => hits.push(hit));
    return { events, dummy, hits };
  }

  it('a bullet that hits the dummy damages it', () => {
    const { events, dummy, hits } = setup(false);
    events.emit('weapon:fired', { weapon: 'rifle' });
    expect(hits).toEqual([{ zone: 'body', killed: false }]);
    expect(dummy.health.current).toBe(d.healthPoints - rifleConfigDefaults.bodyDamagePerHit);
  });

  it('a wall in front of the dummy takes the bullet instead', () => {
    const { events, dummy, hits } = setup(true);
    events.emit('weapon:fired', { weapon: 'rifle' });
    expect(hits).toEqual([]);
    expect(dummy.health.current).toBe(d.healthPoints);
  });
});
