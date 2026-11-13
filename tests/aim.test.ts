import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { pistolConfigDefaults } from '../src/config/pistol';
import { rifleConfigDefaults } from '../src/config/rifle';
import { EventBus } from '../src/core/events';
import { Input } from '../src/core/input';
import { buildGreybox } from '../src/level/greybox';
import { Player } from '../src/player/player';
import type { WeaponEvents } from '../src/weapons/events';
import { Aim } from '../src/weapons/aim';
import { Shooter } from '../src/weapons/shooter';
import { applySpread } from '../src/weapons/spread';

const dtSec = 1 / 60;

describe('applySpread', () => {
  it('leaves the direction alone with no spread', () => {
    const d = new Vector3(0, 0, -1);
    applySpread(d, 0, 0.5, 0.5);
    expect(d.toArray()).toEqual([0, 0, -1]);
  });

  it('never tilts past the cone, keeps a unit vector, and uses the whole cone', () => {
    const spread = 0.05;
    let widest = 0;
    let seed = 99;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (const start of [new Vector3(0, 0, -1), new Vector3(1, 1, 0).normalize(), new Vector3(0, 1, 0), new Vector3(0, -1, 0)]) {
      for (let i = 0; i < 2000; i++) {
        const d = start.clone();
        applySpread(d, spread, random(), random());
        expect(d.length()).toBeCloseTo(1, 6);
        const angle = Math.acos(Math.min(d.dot(start), 1));
        expect(angle).toBeLessThanOrEqual(spread + 1e-9);
        widest = Math.max(widest, angle);
      }
    }
    expect(widest).toBeGreaterThan(spread * 0.95);
  });

  it('a tighter spread scatters less than a wide one', () => {
    const meanAngle = (spread: number) => {
      let seed = 5;
      const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      let total = 0;
      for (let i = 0; i < 1000; i++) {
        const d = new Vector3(0, 0, -1);
        applySpread(d, spread, random(), random());
        total += Math.acos(Math.min(d.dot(new Vector3(0, 0, -1)), 1));
      }
      return total / 1000;
    };
    expect(meanAngle(rifleConfigDefaults.aimedSpreadRad)).toBeLessThan(meanAngle(rifleConfigDefaults.hipSpreadRad) / 5);
  });
});

describe('Aim', () => {
  it('takes the gun\'s aim time to go up, and to come back down', () => {
    const aim = new Aim();
    let t = 0;
    while (aim.blend < 1 && t < 5) {
      aim.update(dtSec, true, rifleConfigDefaults);
      t += dtSec;
    }
    expect(t).toBeCloseTo(rifleConfigDefaults.aimTimeSec, 1);
    expect(aim.eased).toBe(1);
    t = 0;
    while (aim.blend > 0 && t < 5) {
      aim.update(dtSec, false, rifleConfigDefaults);
      t += dtSec;
    }
    expect(t).toBeCloseTo(rifleConfigDefaults.aimTimeSec, 1);
    expect(aim.eased).toBe(0);
  });

  it('gives the zoom, walking and turning scales of the gun in hand, at full aim', () => {
    const aim = new Aim();
    for (let i = 0; i < 60; i++) aim.update(dtSec, true, pistolConfigDefaults);
    expect(aim.fovDeg(75)).toBeCloseTo(pistolConfigDefaults.aimFovDeg);
    expect(aim.moveSpeedScale).toBeCloseTo(pistolConfigDefaults.aimMoveSpeedScale);
    expect(aim.sensitivityScale).toBeCloseTo(pistolConfigDefaults.aimSensitivityScale);
  });

  it('is exactly normal when not aiming', () => {
    const aim = new Aim();
    aim.update(dtSec, false, rifleConfigDefaults);
    expect(aim.fovDeg(75)).toBe(75);
    expect(aim.moveSpeedScale).toBe(1);
    expect(aim.sensitivityScale).toBe(1);
  });

  it('keeps the blend between 0 and 1 and the knife (no gun) lets it fall', () => {
    const aim = new Aim();
    for (let i = 0; i < 100; i++) aim.update(dtSec, true, rifleConfigDefaults);
    expect(aim.blend).toBe(1);
    for (let i = 0; i < 100; i++) aim.update(dtSec, false, null);
    expect(aim.blend).toBe(0);
  });

  it('survives an aim time of 0 on the panel', () => {
    const aim = new Aim();
    aim.update(dtSec, true, { ...rifleConfigDefaults, aimTimeSec: 0 });
    expect(Number.isFinite(aim.blend)).toBe(true);
    expect(aim.blend).toBe(1);
  });
});

describe('Player speed scale and turning', () => {
  const { collision } = buildGreybox([{ kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 }]);
  const startYawRad = (() => {
    const camera = new PerspectiveCamera();
    new Player(collision).applyToCamera(camera, 1);
    return camera.rotation.y;
  })();
  const distanceWalked = (scale: number) => {
    const input = new Input();
    input.enabled = true;
    input.keyDown('KeyW');
    const player = new Player(collision);
    player.position.set(0, 0, 0);
    player.speedScale = scale;
    for (let i = 0; i < 120; i++) player.fixedUpdate(dtSec, input);
    return Math.hypot(player.position.x, player.position.z);
  };

  it('walking at half speed covers about half the distance', () => {
    const full = distanceWalked(1);
    const half = distanceWalked(0.5);
    expect(full).toBeGreaterThan(5);
    expect(half / full).toBeGreaterThan(0.45);
    expect(half / full).toBeLessThan(0.55);
  });

  it('a lower sensitivity scale turns the view less for the same mouse movement', () => {
    const turned = (scale: number) => {
      const input = new Input();
      input.enabled = true;
      const player = new Player(collision);
      input.addMouseMove(100, 0);
      player.look(input, scale);
      const camera = new PerspectiveCamera();
      player.applyToCamera(camera, 1);
      return Math.abs(camera.rotation.y - startYawRad);
    };
    expect(turned(0.5)).toBeCloseTo(turned(1) / 2);
  });
});

describe('Shooter spread', () => {
  const { collision } = buildGreybox([{ kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 }]);
  const widestAngle = (aimBlend: number): number => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1, 0);
    const events = new EventBus<WeaponEvents>();
    const muzzle = new Vector3();
    const shooter = new Shooter(events, collision, camera, { rifle: muzzle, pistol: muzzle }, [], { rifle: rifleConfigDefaults, pistol: pistolConfigDefaults });
    shooter.aimBlend = aimBlend;
    let widest = 0;
    events.on('shot:landed', (shot) => {
      const direction = shot.end.clone().sub(new Vector3(0, 1, 0)).normalize();
      widest = Math.max(widest, Math.acos(Math.min(direction.dot(new Vector3(0, 0, -1)), 1)));
    });
    for (let i = 0; i < 500; i++) events.emit('weapon:fired', { weapon: 'rifle', heat: 0 });
    return widest;
  };

  it('from the hip shots scatter inside the hip cone', () => {
    const widest = widestAngle(0);
    expect(widest).toBeGreaterThan(rifleConfigDefaults.hipSpreadRad * 0.8);
    expect(widest).toBeLessThanOrEqual(rifleConfigDefaults.hipSpreadRad + 1e-6);
  });

  it('fully aimed shots land in the much tighter aimed cone', () => {
    expect(widestAngle(1)).toBeLessThanOrEqual(rifleConfigDefaults.aimedSpreadRad + 1e-6);
  });

  it('halfway through the aim the cone is halfway between', () => {
    const half = (rifleConfigDefaults.hipSpreadRad + rifleConfigDefaults.aimedSpreadRad) / 2;
    expect(widestAngle(0.5)).toBeLessThanOrEqual(half + 1e-6);
  });
});

// Random play: aiming while switching, reloading, drawing and sprinting. The blend always stays in range.
describe('aim random play', () => {
  it('stays between 0 and 1 and ends at 0 once released', () => {
    let seed = 31337;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const aim = new Aim();
    for (let tick = 0; tick < 20000; tick++) {
      const allowed = random() < 0.7;
      const held = random() < 0.6;
      aim.update(dtSec, allowed && held, random() < 0.3 ? null : random() < 0.5 ? rifleConfigDefaults : pistolConfigDefaults);
      expect(aim.blend).toBeGreaterThanOrEqual(0);
      expect(aim.blend).toBeLessThanOrEqual(1);
      expect(aim.eased).toBeGreaterThanOrEqual(0);
      expect(aim.eased).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < 60; i++) aim.update(dtSec, false, null);
    expect(aim.blend).toBe(0);
  });
});
