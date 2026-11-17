import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { pickupConfig } from '../src/config/pickups';
import { EventBus } from '../src/core/events';
import { Pickups } from '../src/pickups/pickups';
import type { PickupKind, WeaponEvents } from '../src/weapons/events';
import { Magazines } from '../src/weapons/magazines';

/** Pickups that take everything (or what `canTake` allows), recording what was taken and what was announced. */
function setup(canTake: (kind: PickupKind) => boolean = () => true) {
  const events = new EventBus<WeaponEvents>();
  const taken: PickupKind[] = [];
  const announced: PickupKind[] = [];
  events.on('pickup:taken', ({ kind }) => announced.push(kind));
  const pickups = new Pickups(events, (kind) => {
    if (!canTake(kind)) return false;
    taken.push(kind);
    return true;
  });
  const down = (role: 'trooper' | 'flanker' | 'heavy' | 'leader', grenades: number, x = 0, z = 0) =>
    events.emit('enemy:downed', { position: new Vector3(x, 0, z), role, grenades });
  return { pickups, taken, announced, down };
}

describe('what dead contractors drop (4.12)', () => {
  it('a trooper or leader drops its grenade (if it still had one) and an M4-A magazine; a flanker a P9 magazine; a heavy nothing', () => {
    const { pickups, down } = setup();
    down('trooper', 1);
    expect(pickups.items.map((item) => item.kind).sort()).toEqual(['grenade', 'rifle']);
    pickups.clear();
    down('leader', 0); // it threw its grenade before it died
    expect(pickups.items.map((item) => item.kind)).toEqual(['rifle']);
    pickups.clear();
    down('flanker', 0);
    expect(pickups.items.map((item) => item.kind)).toEqual(['pistol']);
    pickups.clear();
    down('heavy', 0); // its machine-gun ammo fits neither of Rook's guns
    expect(pickups.items).toHaveLength(0);
  });

  it('the drops lie apart, around where it fell', () => {
    const { pickups, down } = setup();
    down('trooper', 1, 5, -3);
    const [first, second] = pickups.items;
    expect(Math.hypot(first.xM - second.xM, first.zM - second.zM)).toBeGreaterThan(0.1);
    for (const item of pickups.items) expect(Math.hypot(item.xM - 5, item.zM + 3)).toBeLessThanOrEqual(pickupConfig.dropSpreadM + 1e-9);
  });
});

describe('picking things up (4.12)', () => {
  it('walking within reach takes an item and says so; further away nothing happens', () => {
    const { pickups, taken, announced, down } = setup();
    down('flanker', 0, 0, 0);
    pickups.update({ x: 0, z: pickupConfig.pickupRadiusM + 1 });
    expect(taken).toHaveLength(0);
    pickups.update({ x: 0, z: 0.2 });
    expect(taken).toEqual(['pistol']);
    expect(announced).toEqual(['pistol']);
    expect(pickups.items).toHaveLength(0);
  });

  it('a grenade he cannot carry (at his limit) stays on the floor; the magazine beside it is taken', () => {
    const { pickups, taken, down } = setup((kind) => kind !== 'grenade');
    down('trooper', 1);
    pickups.update({ x: 0, z: 0 });
    expect(taken).toEqual(['rifle']);
    expect(pickups.items.map((item) => item.kind)).toEqual(['grenade']);
  });

  it('a picked-up magazine is a full spare in the pouch, and an empty gun can reload from it', () => {
    const magazines = new Magazines(30, 1);
    while (magazines.takeRound());
    expect(magazines.canReload).toBe(false);
    magazines.addFull();
    expect(magazines.spareCount).toBe(1);
    expect(magazines.canReload).toBe(true);
    magazines.reload();
    expect(magazines.loadedRounds).toBe(30);
  });
});
