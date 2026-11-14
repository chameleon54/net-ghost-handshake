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
export class Exposure {
  value = 0;
  private unseenSec = 0;

  /** Once per game update. `glimpses`: one per awake enemy. */
  update(dtSec: number, glimpses: readonly Glimpse[], crouched: boolean): void {
    let fillPerSec = 0;
    let inView = false;
    for (const glimpse of glimpses) {
      fillPerSec = Math.max(fillPerSec, fillRate(glimpse, crouched)); // the fastest enemy counts, not their sum
      if (glimpse.inViewOfLastSpot) inView = true;
    }
    if (fillPerSec > 0) {
      this.unseenSec = 0;
      this.value = clamp01(this.value + fillPerSec * dtSec);
      return;
    }
    this.unseenSec += dtSec;
    const holding = inView && this.unseenSec < exposureConfig.holdMaxSec;
    if (!holding) this.value = clamp01(this.value - exposureConfig.drainPerSec * dtSec);
  }

  /** Back to 0 (instant restart). */
  reset(): void {
    this.value = 0;
    this.unseenSec = 0;
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
