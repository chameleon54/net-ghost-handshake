import { squadConfig } from '../config/squad';

/** Something that can hold a firing slot (an enemy). */
type Member = object;

/** What the squad heard of Rook's gun (4.10): he ran dry, is reloading, or jammed. */
export type PushKind = 'dry' | 'reload' | 'jam';

// The squad coordinator (enemies.md, milestone 4.6): it makes the squad act together. It hands out firing slots (only a
// few enemies fire at once; an enemy asks for a slot before a burst and gives it back after) and keeps the hit budget for
// the whole squad (at most one damaging hit on Rook within any 0.5 s, so several enemies can never hit him at once).
// Since 4.7 it watches how long Rook holds one spot, and when he holds it too long it gives one enemy the flank job (one
// flank at a time, with a wait between them). Since 4.8 flankers get that job first, and when the squad leader goes down
// the squad is disorganised for a while. Since 4.9, while Rook hides, it runs suppress and advance: one enemy pins his
// cover while another moves up, and nobody moves up without that covering fire; flanks get covering fire when someone is
// free. Since 4.10 it hears Rook's gun: a dry click, a reload or a jam opens a push window, and a moment later it pushes
// (a play at once, more movers on a dry gun, a flank at once on a jam). Aggression comes later (4.11). Rules only, no
// drawing.
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
  /** Time left of the disorder after the squad leader went down (4.8). */
  private disorderLeftSec = 0;
  /** Suppress and advance (4.9): who pins Rook's cover, who moves up, and the timers. */
  private suppressMember: Member | null = null;
  private readonly advanceMembers = new Set<Member>();
  /** The one stand-in moving on to another spot (decision 237), or null: one at a time. */
  private repositionMember: Member | null = null;
  /** Hearing Rook's weapon (4.10): the open push window, the reaction delay, and whether it already pushed. */
  private pushWindow: PushKind | null = null;
  private pushWindowLeftSec = 0;
  private pushDelayLeftSec = 0;
  private pushedThisWindow = false;
  private playWaitLeftSec = squadConfig.advanceEverySec;
  /** After the covered move ends, the suppressor keeps on this long. */
  private coverGraceLeftSec = 0;
  /** True while Rook is hidden from every awake enemy (set each update). */
  private rookHidden = false;
  /** Why the last play did not start, for the dev readout, or null. */
  playFailure: string | null = null;

  /**
   * Once per game update, before the enemies. `rook`: where Rook is while the squad knows it (an awake enemy's knowledge
   * is fresh), or null when it does not; then the hold clock starts again.
   */
  update(dtSec: number, rook: { readonly x: number; readonly z: number } | null = null, rookHidden = false): void {
    this.sinceHitSec += dtSec;
    this.flankWaitLeftSec = Math.max(this.flankWaitLeftSec - dtSec, 0);
    this.disorderLeftSec = Math.max(this.disorderLeftSec - dtSec, 0);
    this.playWaitLeftSec = Math.max(this.playWaitLeftSec - dtSec, 0);
    this.coverGraceLeftSec = Math.max(this.coverGraceLeftSec - dtSec, 0);
    this.pushDelayLeftSec = Math.max(this.pushDelayLeftSec - dtSec, 0);
    this.pushWindowLeftSec = Math.max(this.pushWindowLeftSec - dtSec, 0);
    if (this.pushWindowLeftSec <= 0) this.pushWindow = null;
    this.rookHidden = rook !== null && rookHidden;
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

  /** Time left before a flank may start (the wait after one, or the retry). For the dev readout. */
  get flankWaitSec(): number {
    return this.flankWaitLeftSec;
  }

  /** The enemy on the flank job, or null. */
  get flanker(): Member | null {
    return this.flankMember;
  }

  /** True when Rook has held his spot long enough, nobody is flanking, the wait is over, and the squad is not disorganised. */
  get flankDue(): boolean {
    if (this.flankMember !== null || this.flankWaitLeftSec > 0 || this.disorganised) return false;
    return this.holdSec >= squadConfig.holdBeforeFlankSec;
  }

  /** True for a while after the squad leader went down: fewer firing slots, longer holds, no new flank. */
  get disorganised(): boolean {
    return this.disorderLeftSec > 0;
  }

  /** The squad leader went down: the squad is disorganised for a while (enemies.md, "Roles"). */
  leaderDown(): void {
    this.disorderLeftSec = squadConfig.disorderSec;
  }

  /**
   * When a flank is due: asks the candidates for their best plan (null if none) and gives the job to the cheapest. The
   * preferred ones (flankers, decision 217) are asked first; the others only if no preferred one has a plan. Returns the
   * chosen one and its plan, or null, and then it tries again after the retry time.
   */
  assignFlank<M extends Member, P extends { readonly cost: number }>(
    candidates: readonly M[],
    plan: (member: M) => P | null,
    preferred: (member: M) => boolean = () => true,
  ): { member: M; plan: P } | null {
    const cheapest = (group: readonly M[]): { member: M; plan: P } | null => {
      let best: { member: M; plan: P } | null = null;
      for (const member of group) {
        const option = plan(member);
        if (option && (!best || option.cost < best.plan.cost)) best = { member, plan: option };
      }
      return best;
    };
    const best = cheapest(candidates.filter(preferred)) ?? cheapest(candidates.filter((member) => !preferred(member)));
    if (best) this.flankMember = best.member;
    else this.flankWaitLeftSec = squadConfig.flankRetrySec;
    return best;
  }

  /** The flank by `member` is over (arrived, spotted, or anything else): the wait before the next one starts. */
  flankOver(member: Member): void {
    if (this.flankMember !== member) return;
    this.flankMember = null;
    this.flankWaitLeftSec = squadConfig.flankWaitSec;
    this.coverGraceLeftSec = squadConfig.suppressAfterMoveSec;
  }

  /** Who is pinning Rook's cover, and who is moving up under that fire (4.9), or null. */
  get suppressor(): Member | null {
    return this.suppressMember;
  }

  /** Who is moving up under that fire (one, or more in a push). */
  get advancers(): readonly Member[] {
    return [...this.advanceMembers];
  }

  /**
   * The squad heard Rook's gun (4.10): a push window opens (or stays open, if it is the same one). It pushes once, after the
   * reaction delay, if the window is still open then. A dry gun or a jam keeps it open until closed, at most the window
   * limit; a reload until it ends.
   */
  heard(kind: PushKind): void {
    if (this.pushWindow !== kind) {
      this.pushWindow = kind;
      this.pushDelayLeftSec = squadConfig.pushReactionSec;
      this.pushedThisWindow = false;
    }
    this.pushWindowLeftSec = squadConfig.pushMaxWindowSec;
  }

  /** He is no longer vulnerable that way (he fired, his reload ended, his jam is cleared): that window closes. */
  closeWindow(kind: PushKind): void {
    if (this.pushWindow !== kind) return;
    this.pushWindow = null;
    this.pushWindowLeftSec = 0;
  }

  /** The open push window, and the time until the push. For the dev readout. */
  get heardKind(): PushKind | null {
    return this.pushWindow;
  }

  get pushInSec(): number {
    return this.pushDelayLeftSec;
  }

  get pushedAlready(): boolean {
    return this.pushedThisWindow;
  }

  /** The push due now (the window is open, the delay is over, it has not pushed yet, not in disorder), or null. */
  get pushDue(): PushKind | null {
    if (!this.pushWindow || this.pushDelayLeftSec > 0 || this.pushedThisWindow || this.disorganised) return null;
    return this.pushWindow;
  }

  /** The push for the open window has been made (or could not be): one per window. */
  pushStarted(): void {
    this.pushedThisWindow = true;
  }

  /** True while a suppress-and-advance play is running (someone pins, or someone moves up). */
  get playRunning(): boolean {
    return this.suppressMember !== null || this.advanceMembers.size > 0;
  }

  /** One more mover joins the running play (a push moves up more than one). */
  addAdvancer(member: Member): void {
    this.advanceMembers.add(member);
  }

  /** Time before the next suppress-and-advance play may start. For the dev readout. */
  get playWaitSec(): number {
    return this.playWaitLeftSec;
  }

  /** True when a suppress-and-advance play may start: Rook hides where the squad knows he is, and nothing else is on. */
  get playDue(): boolean {
    if (this.playRunning || this.disorganised) return false;
    return this.rookHidden && this.playWaitLeftSec <= 0;
  }

  /**
   * Starts a suppress-and-advance play (enemies.md, "Suppression"): the mover with the cheapest plan moves up, covered by
   * a suppressor who is not the mover (preferred ones first: the heavy). With no plan or nobody to cover, nothing starts
   * ("nobody moves without covering fire") and it tries again later; `playFailure` says why.
   */
  assignAdvance<M extends Member, P extends { readonly cost: number }>(
    movers: readonly M[],
    plan: (member: M) => P | null,
    coverers: readonly M[],
    preferredCover: (member: M) => boolean,
    /** True for a mover that is its own covering fire (the heavy fires on the move, decision 237). */
    selfCovers: (member: M) => boolean = () => false,
  ): { advancer: { member: M; plan: P }; suppressor: M | null } | null {
    let best: { member: M; plan: P } | null = null;
    for (const member of movers) {
      const option = plan(member);
      if (option && (!best || option.cost < best.plan.cost)) best = { member, plan: option };
    }
    const mover = best?.member;
    const others = coverers.filter((member) => member !== mover);
    const suppressor = mover && selfCovers(mover) ? null : (others.find(preferredCover) ?? others[0] ?? null);
    if (!best || (!suppressor && !selfCovers(best.member))) {
      this.playFailure = !best ? 'no closer cover to move up to' : 'nobody to give covering fire';
      this.playWaitLeftSec = squadConfig.playRetrySec;
      return null;
    }
    this.playFailure = null;
    this.advanceMembers.add(best.member);
    this.suppressMember = suppressor;
    this.playWaitLeftSec = squadConfig.advanceEverySec;
    return { advancer: best, suppressor };
  }

  /** Covering fire for a move already under way (a flank): a free suppressor, preferred ones first, or null if none. */
  assignCover<M extends Member>(coverers: readonly M[], preferred: (member: M) => boolean): M | null {
    if (this.suppressMember !== null) return null;
    const suppressor = coverers.find(preferred) ?? coverers[0] ?? null;
    this.suppressMember = suppressor;
    return suppressor;
  }

  /** True while `member` should keep pinning: it is the suppressor and the move it covers is on (or just over). */
  keepSuppressing(member: Member): boolean {
    if (member !== this.suppressMember) return false;
    const moving = this.advanceMembers.size > 0 || this.flankMember !== null || this.repositionMember !== null;
    return moving || this.coverGraceLeftSec > 0;
  }

  /** The suppressor stopped (the move is over, its time is up, it was hurt, or anything else). */
  suppressOver(member: Member): void {
    if (member === this.suppressMember) this.suppressMember = null;
  }

  /** The advance by `member` is over (arrived, or anything else): its covering fire stops a moment later. */
  advanceOver(member: Member): void {
    if (!this.advanceMembers.delete(member)) return;
    if (this.advanceMembers.size === 0) this.coverGraceLeftSec = squadConfig.suppressAfterMoveSec;
  }

  /** Who is moving on to another spot (decision 237), or null. */
  get repositioner(): Member | null {
    return this.repositionMember;
  }

  /** `member` may move on to another spot now: true, and it is the one repositioning, if nobody else is (one at a time). */
  assignReposition(member: Member): boolean {
    if (this.repositionMember !== null && this.repositionMember !== member) return false;
    this.repositionMember = member;
    return true;
  }

  /** The reposition by `member` is over: its covering fire (if any) stops a moment later. */
  repositionOver(member: Member): void {
    if (member !== this.repositionMember) return;
    this.repositionMember = null;
    this.coverGraceLeftSec = squadConfig.suppressAfterMoveSec;
  }

  /** Dev panel testing aid: a suppress-and-advance play may start now (if Rook hides and nothing else is on). */
  forcePlay(): void {
    this.playWaitLeftSec = 0;
  }

  /** Dev panel testing aid: a flank is due now (if nobody is flanking). */
  forceFlank(): void {
    this.holdSec = Math.max(this.holdSec, squadConfig.holdBeforeFlankSec);
    this.flankWaitLeftSec = 0;
  }

  /** Asks for a firing slot: true if `member` holds one now (it already did, or one was free). */
  requestSlot(member: Member): boolean {
    if (this.holders.has(member)) return true;
    const slots = this.disorganised ? Math.min(squadConfig.disorderSlots, squadConfig.firingSlots) : squadConfig.firingSlots;
    if (this.holders.size >= slots) return false;
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
    this.disorderLeftSec = 0;
    this.suppressMember = null;
    this.advanceMembers.clear();
    this.repositionMember = null;
    this.playWaitLeftSec = squadConfig.advanceEverySec;
    this.pushWindow = null;
    this.pushWindowLeftSec = 0;
    this.pushDelayLeftSec = 0;
    this.pushedThisWindow = false;
    this.coverGraceLeftSec = 0;
    this.rookHidden = false;
    this.playFailure = null;
  }
}
