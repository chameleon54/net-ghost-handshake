import { squadConfig } from '../config/squad';

/** Something that can hold a firing slot (an enemy). */
type Member = object;

// The squad coordinator (enemies.md, milestone 4.6): it makes the squad act together. It hands out firing slots (only a
// few enemies fire at once; an enemy asks for a slot before a burst and gives it back after) and keeps the hit budget for
// the whole squad (at most one damaging hit on Rook within any 0.5 s, so several enemies can never hit him at once).
// Since 4.7 it watches how long Rook holds one spot, and when he holds it too long it gives one enemy the flank job (one
// flank at a time, with a wait between them). Roles and covering fire come later (4.8 to 4.11). Rules only, no drawing.
export class SquadCoordinator {
  private readonly holders = new Set<Member>();
  /** Game time since any enemy last landed a damaging hit. */
  private sinceHitSec = Infinity;
  /** Where Rook settled, and how long he has stayed near it (while the squad knew where he was). */
  private readonly holdSpot = { x: 0, z: 0 };
  private hasHoldSpot = false;
  private holdSec = 0;
  /** The enemy on the flank job, or null. */
  private flankMember: Member | null = null;
  /** Time left before a flank may start (the wait after one, or the retry when nobody could). */
  private flankWaitLeftSec = 0;

  /**
   * Once per game update, before the enemies. `rook`: where Rook is while the squad knows it (an awake enemy's knowledge
   * is fresh), or null when it does not; then the hold clock starts again.
   */
  update(dtSec: number, rook: { readonly x: number; readonly z: number } | null = null): void {
    this.sinceHitSec += dtSec;
    this.flankWaitLeftSec = Math.max(this.flankWaitLeftSec - dtSec, 0);
    if (!rook) {
      this.hasHoldSpot = false;
      this.holdSec = 0;
      return;
    }
    if (!this.hasHoldSpot || Math.hypot(rook.x - this.holdSpot.x, rook.z - this.holdSpot.z) > squadConfig.holdRadiusM) {
      this.holdSpot.x = rook.x; // he moved: a new spot, and the clock starts again
      this.holdSpot.z = rook.z;
      this.hasHoldSpot = true;
      this.holdSec = 0;
      return;
    }
    this.holdSec += dtSec;
  }

  /** How long Rook has held his spot. For the dev readout. */
  get heldSec(): number {
    return this.holdSec;
  }

  /** The enemy on the flank job, or null. */
  get flanker(): Member | null {
    return this.flankMember;
  }

  /** True when Rook has held his spot long enough, nobody is flanking, and the wait is over. */
  get flankDue(): boolean {
    return this.flankMember === null && this.flankWaitLeftSec <= 0 && this.holdSec >= squadConfig.holdBeforeFlankSec;
  }

  /**
   * When a flank is due: asks each candidate for its best plan (null if it has none) and gives the job to the cheapest.
   * Returns the chosen one and its plan, or null, and then it tries again after the retry time.
   */
  assignFlank<M extends Member, P extends { readonly cost: number }>(candidates: readonly M[], plan: (member: M) => P | null): { member: M; plan: P } | null {
    let best: { member: M; plan: P } | null = null;
    for (const member of candidates) {
      const option = plan(member);
      if (option && (!best || option.cost < best.plan.cost)) best = { member, plan: option };
    }
    if (best) this.flankMember = best.member;
    else this.flankWaitLeftSec = squadConfig.flankRetrySec;
    return best;
  }

  /** The flank by `member` is over (arrived, spotted, or anything else): the wait before the next one starts. */
  flankOver(member: Member): void {
    if (this.flankMember !== member) return;
    this.flankMember = null;
    this.flankWaitLeftSec = squadConfig.flankWaitSec;
  }

  /** Dev panel testing aid: a flank is due now (if nobody is flanking). */
  forceFlank(): void {
    this.holdSec = Math.max(this.holdSec, squadConfig.holdBeforeFlankSec);
    this.flankWaitLeftSec = 0;
  }

  /** Asks for a firing slot: true if `member` holds one now (it already did, or one was free). */
  requestSlot(member: Member): boolean {
    if (this.holders.has(member)) return true;
    if (this.holders.size >= squadConfig.firingSlots) return false;
    this.holders.add(member);
    return true;
  }

  /** Gives a slot back (nothing happens if `member` held none). */
  releaseSlot(member: Member): void {
    this.holders.delete(member);
  }

  holdsSlot(member: Member): boolean {
    return this.holders.has(member);
  }

  get slotsHeld(): number {
    return this.holders.size;
  }

  /** True if a round may hit Rook now: no enemy has hit him within the hit budget's window. */
  mayHit(): boolean {
    return this.sinceHitSec >= squadConfig.hitGapSec;
  }

  /** A round hit Rook: the budget is spent for the next window. */
  hitLanded(): void {
    this.sinceHitSec = 0;
  }

  /** No slots held, the budget fresh, no flank and no hold time (instant restart). */
  reset(): void {
    this.holders.clear();
    this.sinceHitSec = Infinity;
    this.hasHoldSpot = false;
    this.holdSec = 0;
    this.flankMember = null;
    this.flankWaitLeftSec = 0;
  }
}
