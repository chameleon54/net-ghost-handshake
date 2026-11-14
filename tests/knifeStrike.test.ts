import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { knifeConfigDefaults } from '../src/config/knife';
import { EventBus } from '../src/core/events';
import { Dummy } from '../src/enemies/dummy';
import type { RoomBox } from '../src/data/greyboxRoom';
import { buildGreybox } from '../src/level/greybox';
import type { WeaponEvents } from '../src/weapons/events';
import { KnifeStrike } from '../src/weapons/knifeStrike';

const farCrate: RoomBox = { kind: 'prop', xM: 50, zM: 50, widthM: 1, depthM: 1, heightM: 1 };

// The camera is at the origin, eye height 1.0, looking down -z (a camera with no rotation does).
function setup(dummy: Dummy, extraBoxes: RoomBox[] = []) {
  const { collision } = buildGreybox([farCrate, ...extraBoxes]);
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1.0, 0);
  const events = new EventBus<WeaponEvents>();
  new KnifeStrike(events, collision, camera, [dummy]);
  const hits: { zone: string; killed: boolean; weapon: string }[] = [];
  events.on('target:hit', (hit) => hits.push(hit));
  return { swing: () => events.emit('weapon:swing', undefined), hits };
}

describe('KnifeStrike', () => {
  it('from the front it does the front damage', () => {
    const dummy = new Dummy(0, -1, Math.PI); // 1 m ahead, facing the player
    const { swing, hits } = setup(dummy);
    swing();
    expect(hits).toEqual([{ zone: 'body', killed: false, weapon: 'knife' }]);
    expect(dummy.health.current).toBe(100 - knifeConfigDefaults.frontDamagePerHit);
  });

  it('from behind it kills at once', () => {
    const dummy = new Dummy(0, -1, 0); // facing away from the player
    const { swing, hits } = setup(dummy);
    swing();
    expect(hits).toEqual([{ zone: 'body', killed: true, weapon: 'knife' }]);
    expect(dummy.state).toBe('falling');
  });

  it('two front hits kill a full-health dummy', () => {
    const dummy = new Dummy(0, -1, Math.PI);
    const { swing, hits } = setup(dummy);
    swing();
    swing();
    expect(hits.map((h) => h.killed)).toEqual([false, true]);
  });

  it('cannot reach a dummy that is too far away', () => {
    const dummy = new Dummy(0, -(knifeConfigDefaults.reachM + 1), Math.PI);
    const { swing, hits } = setup(dummy);
    swing();
    expect(hits).toEqual([]);
  });

  it('cannot reach through a wall', () => {
    const dummy = new Dummy(0, -1.2, 0);
    const wall: RoomBox = { kind: 'wall', xM: 0, zM: -0.6, widthM: 3, depthM: 0.1, heightM: 3 };
    const { swing, hits } = setup(dummy, [wall]);
    swing();
    expect(hits).toEqual([]);
    expect(dummy.health.current).toBe(100);
  });
});
