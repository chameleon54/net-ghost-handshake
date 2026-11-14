import { describe, expect, it } from 'vitest';
import { healthConfig, healthConfigDefaults } from '../src/config/health';
import { playerConfig } from '../src/config/player';
import { EventBus } from '../src/core/events';
import { Input } from '../src/core/input';
import { greyboxHazards, greyboxRoom } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import { standsOnHazard } from '../src/level/hazards';
import { fallDamage, fallSlowSec } from '../src/player/fall';
import { Player } from '../src/player/player';
import { LedgeProbe } from '../src/player/mantle';
import { Vector3 } from 'three';
import { PlayerHealth } from '../src/player/playerHealth';
import type { WeaponEvents } from '../src/weapons/events';
import { Gun } from '../src/weapons/gun';
import { rifleConfig } from '../src/config/rifle';
import { healthFolder, healthKeysNotOnPanel } from '../src/debug/tuning';

const dt = 1 / 60;

describe('PlayerHealth', () => {
  it('takes damage, says so, and dies once at 0', () => {
    const events = new EventBus<WeaponEvents>();
    const damaged: number[] = [];
    let deaths = 0;
    events.on('player:damaged', ({ health }) => damaged.push(health));
    events.on('player:died', () => deaths++);
    const health = new PlayerHealth(events);

    health.damage(30, 'hazard');
    expect(health.current).toBe(70);
    health.damage(500, 'blast');
    expect(health.dead).toBe(true);
    health.damage(10, 'hazard'); // dead people take nothing more
    expect(damaged).toEqual([70, 0]);
    expect(deaths).toBe(1);
  });

  it('takes nothing while invulnerable, and reset brings full health back', () => {
    const health = new PlayerHealth(new EventBus<WeaponEvents>());
    health.invulnerable = true;
    health.damage(50, 'debug');
    expect(health.current).toBe(healthConfig.maxHealth);
    health.invulnerable = false;
    health.damage(500, 'debug');
    health.reset();
    expect(health.dead).toBe(false);
    expect(health.current).toBe(healthConfig.maxHealth);
  });
});

describe('fall damage', () => {
  it('is nothing at or below the safe speed, and 12 per m/s above it (decision 115)', () => {
    expect(fallDamage(10)).toBe(0);
    expect(fallDamage(5)).toBe(0);
    expect(fallDamage(12)).toBeCloseTo(24);
  });

  it('slows walking for 1 s plus 0.3 s per m/s over, at most 4 s', () => {
    expect(fallSlowSec(10)).toBe(0);
    expect(fallSlowSec(12)).toBeCloseTo(1.6);
    expect(fallSlowSec(30)).toBe(healthConfigDefaults.fallSlowMaxSec);
  });
});

describe('landing', () => {
  const { collision } = buildGreybox(greyboxRoom);
  const input = new Input();
  input.enabled = true;

  function drop(fromY: number): { player: Player; landings: number[] } {
    const player = new Player(collision);
    player.position.set(0, fromY, 4.5); // open floor
    player.grounded = false;
    const landings: number[] = [];
    player.onLanded = (speed) => landings.push(speed);
    for (let i = 0; i < 300; i++) player.fixedUpdate(dt, input);
    return { player, landings };
  }

  it('reports one landing, at about the free-fall speed, and a safe drop does not slow the player', () => {
    const { player, landings } = drop(2.0); // v = sqrt(2 * 20 * 2) = 8.9 m/s
    expect(landings).toHaveLength(1);
    expect(landings[0]).toBeGreaterThan(8);
    expect(landings[0]).toBeLessThan(10);
    expect(player.slowed).toBe(false);
  });

  it('a high drop (3.8 m, about 12.3 m/s) hurts about 28 and slows walking, and the slow wears off', () => {
    const { player, landings } = drop(3.8);
    expect(landings).toHaveLength(1);
    expect(fallDamage(landings[0])).toBeGreaterThan(25);
    expect(fallDamage(landings[0])).toBeLessThan(31);
    const slowedNow = new Player(collision);
    slowedNow.position.set(0, 3.8, 4.5);
    slowedNow.grounded = false;
    for (let i = 0; i < 40; i++) slowedNow.fixedUpdate(dt, input); // just landed
    expect(slowedNow.slowed).toBe(true);
    expect(player.slowed).toBe(false); // the first player ran 5 s: long enough
  });

  it('respawn puts the player at the start, still and unslowed', () => {
    const { player } = drop(3.8);
    player.position.set(5, 0, -1);
    player.respawn();
    expect(player.position.x).toBe(playerConfig.startXM);
    expect(player.position.z).toBe(playerConfig.startZM);
    expect(player.slowed).toBe(false);
    expect(player.speedMps).toBe(0);
  });
});

describe('the hazard pad', () => {
  const pad = greyboxHazards[0];

  it('hurts on the floor inside it, not outside, and not from up on something above it', () => {
    expect(standsOnHazard(pad.xM, 0, pad.zM, greyboxHazards)).toBe(true);
    expect(standsOnHazard(pad.xM + pad.widthM, 0, pad.zM, greyboxHazards)).toBe(false);
    expect(standsOnHazard(pad.xM, 1.0, pad.zM, greyboxHazards)).toBe(false);
  });

  it('kills a full-health player in a few seconds', () => {
    expect(healthConfig.maxHealth / healthConfig.hazardDamagePerSec).toBeLessThan(10);
  });
});

describe('the stacked test platform', () => {
  const { collision } = buildGreybox(greyboxRoom);

  it('has its top 3.8 m up on the west edge of the first platform, leaving the rest free to stand on', () => {
    const top = new Player(collision);
    top.position.set(-2.65, 3.8, -4);
    expect(collision.overlapsCapsule(top.position, playerConfig.capsuleRadiusM, 1.8, 0.02)).toBe(false);
    const east = top.position.clone().set(-1.5, 1.9, -4);
    expect(collision.overlapsCapsule(east, playerConfig.capsuleRadiusM, 1.8, 0.02)).toBe(false);
  });

  it('can be climbed from the first platform, standing on its free part and facing west', () => {
    const westYawRad = Math.PI / 2; // yaw 0 faces north (-z); a quarter turn left faces west (-x)
    const plan = new LedgeProbe(collision).probe(new Vector3(-1.9, 1.9, -4), westYawRad, playerConfig.heightM);
    expect(plan?.band).toBe('high');
    expect(plan?.topYM).toBeCloseTo(3.8, 2);
    expect(plan?.onTop).not.toBeNull();
  });
});

describe('resetting a gun', () => {
  it('gives back full magazines and a cold, unjammed gun', () => {
    const events = new EventBus<WeaponEvents>();
    const gun = new Gun(events, 'rifle', rifleConfig, true, () => 0.99);
    for (let i = 0; i < 20; i++) gun.update(dt, { triggerHeld: true, triggerPressed: true, reloadPressed: false, checkRequested: false, canFire: true });
    expect(gun.magazines.totalRounds).toBeLessThan(rifleConfig.magazineRounds * rifleConfig.startingMagazines + 1);
    expect(gun.heat).toBeGreaterThan(0);
    gun.reset();
    expect(gun.heat).toBe(0);
    expect(gun.jammed).toBe(false);
    expect(gun.magazines.loadedRounds).toBe(rifleConfig.magazineRounds + 1);
    expect(gun.magazines.spareCount).toBe(rifleConfig.startingMagazines - 1);
  });
});

describe('the health tuning panel', () => {
  it('lists every health value with a sensible range around its default', () => {
    for (const s of healthFolder.sliders) {
      expect(s.min).toBeLessThan(s.max);
      expect(healthConfigDefaults[s.key], s.key).toBeGreaterThanOrEqual(s.min);
      expect(healthConfigDefaults[s.key], s.key).toBeLessThanOrEqual(s.max);
    }
    const listed = new Set<string>([...healthFolder.sliders.map((s) => s.key), ...healthKeysNotOnPanel]);
    for (const key of Object.keys(healthConfigDefaults)) expect(listed.has(key), `${key} is not on the panel`).toBe(true);
  });
});
