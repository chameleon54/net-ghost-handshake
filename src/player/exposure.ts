import { exposureConfig } from '../config/exposure';

/** What one enemy sees of Rook right now. The world measures it with rays; tests make it up. */
export interface Glimpse {
  /** Share of Rook's three body points (head, chest, hips) in clear view of its eyes, 0 to 1. 0: it does not see him. */
  visibleShare: number;
  distanceM: number;
  /** True when it is beside or behind him: more than 90 degrees from where he looks. */
  fromSide: boolean;
  /** True while he is still in view of the spot it last saw him from (it may have ducked back into cover since). */
  inViewOfLastSpot: boolean;
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

// The hidden exposure meter (gameplay.md, decision 220): 0 to 1, how exposed Rook is. It fills while an enemy sees him,
// faster the more of him it sees and the closer it is. A peeking enemy is hidden most of the time, so the meter does not
// drop just because nobody is looking: it holds while he is still in view of where an enemy last saw him from, and only
// drains once he is behind cover (or after a while with nobody seeing him). Enemies read it for their hit chance.
// Since 4.9 a side of his cover can be pinned by suppressing fire: if he is seen after leaning or stepping out on that
// side, the meter starts at least half full, so hits come sooner (gameplay.md, decision 31).
export class Exposure {
  value = 0;
  private unseenSec = 0;
  private seenBefore = false;
  /** The pinned side: where he hid (feet), the way toward the pinned side (a unit vector), and how long it lasts. */
  private readonly pinAnchor = { x: 0, z: 0 };
  private readonly pinSide = { x: 0, z: 0 };
  private pinLeftSec = 0;

  /** True while a side of his cover is pinned. */
  get pinned(): boolean {
    return this.pinLeftSec > 0;
  }

  /** Suppressing fire landed on one side of his cover: `anchor` is where he hid, `side` points to that side (unit). */
  pin(anchor: { readonly x: number; readonly z: number }, side: { readonly x: number; readonly z: number }): void {
    this.pinAnchor.x = anchor.x;
    this.pinAnchor.z = anchor.z;
    this.pinSide.x = side.x;
    this.pinSide.z = side.z;
    this.pinLeftSec = exposureConfig.pinnedExtraSec;
  }

  /** True if eyes at (x, z) are out on the pinned side. */
  outOnPinnedSide(x: number, z: number): boolean {
    if (!this.pinned) return false;
    return (x - this.pinAnchor.x) * this.pinSide.x + (z - this.pinAnchor.z) * this.pinSide.z >= exposureConfig.pinnedSideM;
  }

  /** Once per game update. `glimpses`: one per awake enemy. `eyes`: where his eyes are (for the pinned side). */
  update(dtSec: number, glimpses: readonly Glimpse[], crouched: boolean, eyes?: { readonly x: number; readonly z: number }): void {
    this.pinLeftSec = Math.max(this.pinLeftSec - dtSec, 0);
    let fillPerSec = 0;
    let inView = false;
    for (const glimpse of glimpses) {
      fillPerSec = Math.max(fillPerSec, fillRate(glimpse, crouched)); // the fastest enemy counts, not their sum
      if (glimpse.inViewOfLastSpot) inView = true;
    }
    if (fillPerSec > 0) {
      // Seen again after hiding, out on a pinned side: the meter starts partly full.
      if (!this.seenBefore && eyes && this.outOnPinnedSide(eyes.x, eyes.z)) {
        this.value = Math.max(this.value, exposureConfig.pinnedStartExposure);
      }
      this.seenBefore = true;
      this.unseenSec = 0;
      this.value = clamp01(this.value + fillPerSec * dtSec);
      return;
    }
    this.seenBefore = false;
    this.unseenSec += dtSec;
    const holding = inView && this.unseenSec < exposureConfig.holdMaxSec;
    if (!holding) this.value = clamp01(this.value - exposureConfig.drainPerSec * dtSec);
  }

  /** Back to 0 (instant restart). */
  reset(): void {
    this.value = 0;
    this.unseenSec = 0;
    this.seenBefore = false;
    this.pinLeftSec = 0;
  }
}

/** How fast one enemy's view fills the meter, per second. 0 if it does not see him. */
export function fillRate(glimpse: Glimpse, crouched: boolean): number {
  if (glimpse.visibleShare <= 0) return 0;
  const { fillPerSec, fullFillRangeM, farRangeM, farFillShare, crouchFillShare, sideFillScale } = exposureConfig;
  const farShare = clamp01((glimpse.distanceM - fullFillRangeM) / Math.max(farRangeM - fullFillRangeM, 1e-6));
  const distanceShare = 1 - farShare * (1 - farFillShare);
  return (
    fillPerSec * glimpse.visibleShare * distanceShare * (crouched ? crouchFillShare : 1) * (glimpse.fromSide ? sideFillScale : 1)
  );
}

/** The chance a round aimed at Rook hits: 0 below the start exposure, rising straight to the most at full; less when he moves fast. */
export function hitChance(exposure: number, movingFast: boolean): number {
  const { hitStartExposure, maxHitChance, movingHitShare } = exposureConfig;
  const rise = clamp01((exposure - hitStartExposure) / Math.max(1 - hitStartExposure, 1e-6));
  return maxHitChance * rise * (movingFast ? movingHitShare : 1);
}

/** How far a miss passes from his chest: far at exposure 0, close at full, so impacts get closer as the meter fills. */
export function missOffsetM(exposure: number): number {
  const { missFarOffsetM, missNearOffsetM } = exposureConfig;
  return missFarOffsetM + (missNearOffsetM - missFarOffsetM) * clamp01(exposure);
}
