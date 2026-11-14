import { squadConfig } from '../config/squad';

/** Something that can hold a firing slot (an enemy). */
type Member = object;

// The squad coordinator (enemies.md, milestone 4.6): it makes the squad act together. So far it hands out firing slots
// (only a few enemies fire at once; an enemy asks for a slot before a burst and gives it back after) and keeps the hit
// budget for the whole squad (at most one damaging hit on Rook within any 0.5 s, so several enemies can never hit him at
// once). Roles, flanking and covering fire come later (4.7 to 4.11). Rules only, no drawing.
export class SquadCoordinator {
  private readonly holders = new Set<Member>();
  /** Game time since any enemy last landed a damaging hit. */
  private sinceHitSec = Infinity;

  /** Once per game update, before the enemies. */
  update(dtSec: number): void {
    this.sinceHitSec += dtSec;
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

  /** No slots held and the budget fresh (instant restart). */
  reset(): void {
    this.holders.clear();
    this.sinceHitSec = Infinity;
  }
}
