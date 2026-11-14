import { describe, expect, it } from 'vitest';
import { rifleConfigDefaults as c } from '../src/config/rifle';
import { Recoil } from '../src/weapons/recoil';

describe('Recoil', () => {
  it('climbs during a spray but never past the maximum', () => {
    const r = new Recoil();
    for (let i = 0; i < 100; i++) r.kick(1);
    expect(r.pitchRad).toBeCloseTo(c.recoilMaxPitchRad);
    expect(r.yawRad).toBeCloseTo(c.recoilMaxYawRad);
  });

  it('stays put during the delay, then settles back to zero', () => {
    const r = new Recoil();
    r.kick(-1);
    r.update(c.recoilRecoveryDelaySec / 2);
    expect(r.pitchRad).toBeCloseTo(c.recoilPitchPerShotRad);
    for (let i = 0; i < 600; i++) r.update(1 / 60);
    expect(r.pitchRad).toBe(0);
    expect(r.yawRad).toBe(0);
  });
});
