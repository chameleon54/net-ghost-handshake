import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { coverConfig } from '../src/config/cover';
import { greyboxCover } from '../src/data/greyboxCover';
import { greyboxRoom } from '../src/data/greyboxRoom';
import { CoverPoints, type CoverPoint } from '../src/level/cover';
import { buildGreybox } from '../src/level/greybox';
import { Navigation } from '../src/level/navigation';

// These run on the real test room and its real cover points.
const level = buildGreybox();
const cover = new CoverPoints(greyboxCover, level.collision);
let navigation: Navigation;
beforeAll(async () => {
  navigation = await Navigation.create(level.navigationGeometry);
});

const eyesAt = (x: number, z: number) => new Vector3(x, 1.6, z);
const spot = (x: number, z: number): CoverPoint => {
  const found = greyboxCover.find((p) => p.xM === x && p.zM === z);
  if (!found) throw new Error(`no cover point at ${x}, ${z}`);
  return found;
};
const straightLine = (from: Vector3) => (p: CoverPoint) => Math.hypot(p.xM - from.x, p.zM - from.z);

describe('the cover points in the test room', () => {
  it('are all on the navigation mesh, clear of every prop', () => {
    const onMesh = new Vector3();
    for (const p of greyboxCover) {
      expect(navigation.closestPoint(new Vector3(p.xM, 0, p.zM), onMesh)).toBe(true);
      expect(Math.hypot(onMesh.x - p.xM, onMesh.z - p.zM), `${p.xM}, ${p.zM}`).toBeLessThan(0.05);
    }
  });

  it('each point toward a prop within a metre in the direction they face', () => {
    for (const p of greyboxCover) {
      const x = p.xM - Math.sin(p.facingYawRad) * 0.6;
      const z = p.zM - Math.cos(p.facingYawRad) * 0.6;
      const inside = greyboxRoom.some((b) => b.kind === 'prop' && Math.abs(x - b.xM) <= b.widthM / 2 && Math.abs(z - b.zM) <= b.depthM / 2);
      expect(inside, `${p.xM}, ${p.zM} faces nothing`).toBe(true);
    }
  });
});

describe('CoverPoints.hides', () => {
  it('a spot behind the pillar hides from the far side, not from the near side', () => {
    const northOfPillar = spot(0, -0.75); // high cover, the pillar to its south
    expect(cover.hides(northOfPillar, eyesAt(0, 5))).toBe(true); // Rook to the south, behind the pillar
    expect(cover.hides(northOfPillar, eyesAt(0, -5))).toBe(false); // Rook to the north sees it
  });

  it('low cover hides a crouched body from a distance, but not from up close and above', () => {
    const behindCrate = spot(-4, -1.05); // south of the low crate, the crate to its north
    expect(cover.hides(behindCrate, eyesAt(-4, -8))).toBe(true); // 7 m north of it
    expect(cover.hides(behindCrate, new Vector3(-4, 1.6, -3.2))).toBe(false); // right over the crate, looking down
  });

  it('follows the eyes: moved far enough to the side, they see past the cover', () => {
    const behindPillar = spot(0, -0.75);
    expect(cover.hides(behindPillar, eyesAt(0, 3))).toBe(true);
    expect(cover.hides(behindPillar, eyesAt(1.2, 3))).toBe(true); // still behind the pillar from here
    expect(cover.hides(behindPillar, eyesAt(3, 3))).toBe(false); // far enough round to see past it
  });
});

describe('CoverPoints.best', () => {
  it('picks a spot that hides, in the liked range if one exists, and claims it', () => {
    const rookFeet = new Vector3(0, 0, 4.5);
    const rookEyes = eyesAt(0, 4.5);
    const owner = {};
    const chosen = cover.best(owner, rookEyes, rookFeet, straightLine(new Vector3(1.5, 0, -5)));
    expect(chosen).not.toBeNull();
    expect(cover.hides(chosen!, rookEyes)).toBe(true);
    const fromRookM = Math.hypot(chosen!.xM - rookFeet.x, chosen!.zM - rookFeet.z);
    expect(fromRookM).toBeGreaterThanOrEqual(coverConfig.preferMinM);
    expect(fromRookM).toBeLessThanOrEqual(coverConfig.preferMaxM);
    expect(cover.claimedBy(chosen!)).toBe(owner);
    cover.clearClaims();
  });

  it('skips a spot someone else holds, and lets go of the old spot when picking a new one', () => {
    const rookFeet = new Vector3(0, 0, 4.5);
    const rookEyes = eyesAt(0, 4.5);
    const first = {};
    const second = {};
    const walk = straightLine(new Vector3(1.5, 0, -5));
    const a = cover.best(first, rookEyes, rookFeet, walk);
    const b = cover.best(second, rookEyes, rookFeet, walk);
    expect(b).not.toBe(a);
    const again = cover.best(first, eyesAt(0, -5.5), new Vector3(0, 0, -5.5), walk); // Rook moved to the north
    expect(cover.claimedBy(a!)).toBe(again === a ? first : null);
    cover.clearClaims();
  });

  it('skips spots it cannot walk to, and gives null when nothing hides', () => {
    const rookFeet = new Vector3(0, 0, 4.5);
    expect(cover.best({}, eyesAt(0, 4.5), rookFeet, () => Infinity)).toBeNull();
    // From high above the middle of the room every spot can be seen.
    expect(cover.best({}, new Vector3(0, 30, 0), rookFeet, () => 1)).toBeNull();
    cover.clearClaims();
  });
});
