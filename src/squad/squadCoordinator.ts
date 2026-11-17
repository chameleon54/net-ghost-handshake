import { aggressionConfig, aggressionSetting, type TierValues } from '../config/aggression';
import { enemyGrenadeConfig } from '../config/enemyGrenades';
import { squadConfig } from '../config/squad';

/** Something that can hold a firing slot (an enemy). */
type Member = object;

/** The member with the cheapest plan (null plans left out), or null if none has one. */
function cheapestOf<M extends Member, P extends { readonly cost: number }>(
  group: readonly M[],
  plan: (member: M) => P | null,
): { member: M; plan: P } | null {
  let best: { member: M; plan: P } | null = null;
  for (const member of group) {
    const option = plan(member);
    if (option && (!best || option.cost < best.plan.cost)) best = { member, plan: option };
  }
  return best;
}

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
// (a play at once, more movers on a dry gun, a flank at once on a jam). Since 4.11 its aggression tier decides which of
// these it may use and how often (src/config/aggression.ts): Cautious has no suppressing fire at all, the pincer sends
// two flankers at once, and the hearing reacts only some of the time at the lower tiers. Since the hunt (4.11, decision
// 235), when the squad's knowledge of Rook stays old long enough it comes looking: one leads to cover near where it last
// knew he was, others follow cover by cover, one watches; found, the hunt ends; nothing found, it holds carefully until
// it sees or hears him. One hunt per lost contact. Since 4.12 (decision 249), when Rook has held one spot even longer than
// the flank waits for and no flank is under way, one enemy with a grenade lobs it at him (from Assertive), then the squad
// waits a while before the next. Rules only, no drawing.
export class SquadCoordinator {
  constructor(private readonly random: () => number = Math.random) {}

  private readonly holders = new Set<Member>();
  /** Game time since any enemy last landed a damaging hit. */
  private sinceHitSec = Infinity;
  /** Where Rook settled, and how long he has stayed near it (while the squad knew where he was). */
  private readonly holdSpot = { x: 0, z: 0 };
  private hasHoldSpot = false;
  private holdSec = 0;
  /** The enemies on the flank job: one, or two in a pincer (4.11). */
  private readonly flankMembers = new Set<Member>();
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
  private pushIgnoredThisWindow = false;
  private playWaitLeftSec = this.tier.playEverySec;
  /** After the covered move ends, the suppressor keeps on this long. */
  private coverGraceLeftSec = 0;
  /** True while Rook is hidden from every awake enemy (set each update). */
  private rookHidden = false;
  /** Why the last play did not start, for the dev readout, or null. */
  playFailure: string | null = null;
  /**
   * The hunt (decision 235): how long the squad's knowledge has been old, whether a hunt is on, whether one already ran
   * since the last contact, whether it found nothing (the careful hold), where the squad last knew Rook was, and who leads,
   * follows and watches.
   */
  private staleSec = 0;
  private huntOn = false;
  private huntSpent = false;
  private careful = false;
  private readonly lastSpot = { x: 0, z: 0 };
  private huntLeaderMember: Member | null = null;
  private leaderDone = false;
  private readonly huntFollowerMembers = new Set<Member>();
  private huntWatcherMember: Member | null = null;
  private huntStepWaitLeftSec = 0;
  private huntLookLeftSec = 0;
  private huntRetryLeftSec = 0;
  /** Why the last hunt could not start, for the dev readout, or null. */
  huntFailure: string | null = null;
  /** How the last hunt ended, for the dev readout, or null. */
  huntResult: 'found' | 'nothing' | null = null;
  /** Enemy grenades (4.12): who is throwing, and the time left before another throw may start (cooldown or retry). */
  private throwMember: Member | null = null;
  private grenadeWaitLeftSec = 0;
  /** Why the last throw could not start, for the dev readout, or null. */
  grenadeFailure: string | null = null;

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
    this.grenadeWaitLeftSec = Math.max(this.grenadeWaitLeftSec - dtSec, 0);
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

  /** The values of the tier it fights at now (4.11). */
  get tier(): TierValues {
    return aggressionConfig[aggressionSetting.current];
  }

  /** False at a tier with no suppressing fire (Cautious): no plays, no covering fire, the heavy fires only aimed rounds. */
  get suppressionAllowed(): boolean {
    return this.tier.suppression > 0;
  }

  /** The first enemy on the flank job, or null. */
  get flanker(): Member | null {
    return this.flankMembers.values().next().value ?? null;
  }

  /** Every enemy on the flank job (two in a pincer). */
  get flankers(): readonly Member[] {
    return [...this.flankMembers];
  }

  /** True when Rook has held his spot long enough, nobody is flanking, the wait is over, and the squad is not disorganised. */
  get flankDue(): boolean {
    if (this.flankMembers.size > 0 || this.flankWaitLeftSec > 0 || this.disorganised) return false;
    return this.holdSec >= this.tier.holdBeforeFlankSec;
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
    const best = this.pickFlanker(candidates, plan, preferred);
    if (!best) this.flankWaitLeftSec = squadConfig.flankRetrySec;
    return best;
  }

  /**
   * The second flanker of a pincer (4.11), once the first is under way: the cheapest plan among the candidates (who plan a
   * spot on the other side of Rook), preferred ones first. Null if the tier has no pincer or nobody has a plan; then it
   * stays a single flank.
   */
  assignPincer<M extends Member, P extends { readonly cost: number }>(
    candidates: readonly M[],
    plan: (member: M) => P | null,
    preferred: (member: M) => boolean = () => true,
  ): { member: M; plan: P } | null {
    if (this.tier.pincer <= 0 || this.flankMembers.size !== 1) return null;
    return this.pickFlanker(candidates.filter((member) => !this.flankMembers.has(member)), plan, preferred);
  }

  private pickFlanker<M extends Member, P extends { readonly cost: number }>(
    candidates: readonly M[],
    plan: (member: M) => P | null,
    preferred: (member: M) => boolean,
  ): { member: M; plan: P } | null {
    const best = cheapestOf(candidates.filter(preferred), plan) ?? cheapestOf(candidates.filter((member) => !preferred(member)), plan);
    if (best) this.flankMembers.add(best.member);
    return best;
  }

  /** The flank by `member` is over (arrived, spotted, or anything else). Once every flanker is done, the wait starts. */
  flankOver(member: Member): void {
    if (!this.flankMembers.delete(member) || this.flankMembers.size > 0) return;
    this.flankWaitLeftSec = this.tier.flankWaitSec;
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
      // Whether it reacts is rolled once per window, by the tier (4.11): ignored, the window stays open without a push.
      this.pushIgnoredThisWindow = this.random() >= this.tier.hearChance;
      this.pushedThisWindow = this.pushIgnoredThisWindow;
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

  /** True if the squad let this window pass (its tier reacts only some of the time). For the dev readout. */
  get pushIgnored(): boolean {
    return this.pushIgnoredThisWindow;
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

  /**
   * True when a suppress-and-advance play may start: the tier has suppressing fire, Rook hides where the squad knows he
   * is, and nothing else is on.
   */
  get playDue(): boolean {
    if (this.playRunning || this.disorganised || !this.suppressionAllowed) return false;
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
    if (!this.suppressionAllowed) {
      this.playFailure = 'no suppressing fire at this tier';
      this.playWaitLeftSec = squadConfig.playRetrySec;
      return null;
    }
    const best = cheapestOf(movers, plan);
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
    this.playWaitLeftSec = this.tier.playEverySec;
    return { advancer: best, suppressor };
  }

  /**
   * Covering fire for a move already under way (a flank, a reposition): a free suppressor, preferred ones first, or null
   * if none is free or the tier has no suppressing fire.
   */
  assignCover<M extends Member>(coverers: readonly M[], preferred: (member: M) => boolean): M | null {
    if (this.suppressMember !== null || !this.suppressionAllowed) return null;
    const suppressor = coverers.find(preferred) ?? coverers[0] ?? null;
    this.suppressMember = suppressor;
    return suppressor;
  }

  /** True while `member` should keep pinning: it is the suppressor and the move it covers is on (or just over). */
  keepSuppressing(member: Member): boolean {
    if (member !== this.suppressMember) return false;
    const moving = this.advanceMembers.size > 0 || this.flankMembers.size > 0 || this.repositionMember !== null;
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

  /**
   * Once per game update (the hunt, decision 235): whether any enemy is awake, and whether any awake one knows fresh where
   * Rook is. Fresh knowledge ends a hunt (found) and the careful hold, and allows a new hunt the next time it goes old.
   */
  watchKnowledge(dtSec: number, awake: boolean, fresh: boolean): void {
    if (fresh || !awake) {
      if (fresh && this.huntOn) this.huntResult = 'found';
      this.endHunt();
      this.staleSec = 0;
      this.huntSpent = false;
      this.careful = false;
      return;
    }
    this.staleSec += dtSec;
    this.huntRetryLeftSec = Math.max(this.huntRetryLeftSec - dtSec, 0);
    if (!this.huntOn) return;
    this.huntStepWaitLeftSec = Math.max(this.huntStepWaitLeftSec - dtSec, 0);
    if (this.leaderDone) this.huntLookLeftSec = Math.max(this.huntLookLeftSec - dtSec, 0);
    // The leader has looked long enough and nobody is still walking: nothing found, it holds carefully.
    if (this.leaderDone && this.huntLookLeftSec <= 0 && this.huntFollowerMembers.size === 0) {
      this.endHunt();
      this.huntResult = 'nothing';
      this.careful = true;
    }
  }

  private endHunt(): void {
    this.huntOn = false;
    this.huntLeaderMember = null;
    this.leaderDone = false;
    this.huntFollowerMembers.clear();
    this.huntWatcherMember = null;
  }

  /** How long the squad's knowledge of Rook has been old (0 while it knows where he is). For the dev readout. */
  get staleForSec(): number {
    return this.staleSec;
  }

  /** True while a hunt is on. */
  get hunting(): boolean {
    return this.huntOn;
  }

  /**
   * True while the squad searches for Rook: a hunt is on, or one found nothing and it holds carefully. Meanwhile its
   * choices (which cover hides, how much of a route is in view) are judged from where it last knew he was.
   */
  get searching(): boolean {
    return this.huntOn || this.careful;
  }

  /** Where the squad last knew Rook was, as the hunt took it (his feet). */
  get huntSpot(): { readonly x: number; readonly z: number } {
    return this.lastSpot;
  }

  get huntLeader(): Member | null {
    return this.huntLeaderMember;
  }

  get huntFollowers(): readonly Member[] {
    return [...this.huntFollowerMembers];
  }

  get huntWatcher(): Member | null {
    return this.huntWatcherMember;
  }

  /** True when a hunt should start: the tier hunts, the knowledge has been old long enough, and none ran since the last contact. */
  get huntDue(): boolean {
    if (this.tier.hunt <= 0 || this.huntOn || this.huntSpent || this.disorganised || this.huntRetryLeftSec > 0) return false;
    return this.staleSec > 0 && this.staleSec >= this.tier.huntAfterSec;
  }

  /**
   * Starts a hunt toward `spot` (where the squad last knew Rook was): the leader is the candidate with the cheapest plan,
   * preferred ones first (flankers). The plans are asked once the hunt is on, so they are judged from `spot`. With no plan
   * nothing starts and it tries again later; `huntFailure` says why.
   */
  beginHunt<M extends Member, P extends { readonly cost: number }>(
    spot: { readonly x: number; readonly z: number },
    candidates: readonly M[],
    plan: (member: M) => P | null,
    preferred: (member: M) => boolean,
  ): { member: M; plan: P } | null {
    this.lastSpot.x = spot.x;
    this.lastSpot.z = spot.z;
    this.huntOn = true;
    const best = cheapestOf(candidates.filter(preferred), plan) ?? cheapestOf(candidates.filter((member) => !preferred(member)), plan);
    if (!best) {
      this.huntOn = false;
      this.huntFailure = candidates.length > 0 ? 'no reachable cover near your last spot' : 'nobody can lead (wounded, busy, or heavies only)';
      this.huntRetryLeftSec = squadConfig.huntRetrySec;
      return null;
    }
    this.huntSpent = true;
    this.huntFailure = null;
    this.huntResult = null;
    this.huntLeaderMember = best.member;
    this.huntStepWaitLeftSec = 0; // the first follow step comes at once
    return best;
  }

  /** The watcher of the hunt, instead of covering fire: the first preferred candidate (the heavy), or any, or none. */
  assignWatcher<M extends Member>(candidates: readonly M[], preferred: (member: M) => boolean): M | null {
    if (!this.huntOn) return null;
    const watcher = candidates.find(preferred) ?? candidates[0] ?? null;
    this.huntWatcherMember = watcher;
    return watcher;
  }

  /** True when the followers may take their next step toward the spot. */
  get huntStepDue(): boolean {
    return this.huntOn && this.huntStepWaitLeftSec <= 0;
  }

  /** A follow step was handed out (or nobody could move): the next comes after the tier's interval. */
  huntStepStarted(): void {
    this.huntStepWaitLeftSec = this.tier.huntStepEverySec;
  }

  addHuntFollower(member: Member): void {
    if (this.huntOn) this.huntFollowerMembers.add(member);
  }

  /** The hunt move by `member` is over (arrived, or anything else). The leader's end starts its look. */
  huntMoveOver(member: Member): void {
    this.huntFollowerMembers.delete(member);
    if (member !== this.huntLeaderMember || this.leaderDone) return;
    this.leaderDone = true;
    this.huntLookLeftSec = squadConfig.huntLookSec;
  }

  /** The leader's look time left once it is at its spot, or null before. For the dev readout. */
  get huntLookingSec(): number | null {
    return this.huntOn && this.leaderDone ? this.huntLookLeftSec : null;
  }

  /** How much longer `member` holds between peeks because of the hunt: the watcher less, everyone in a careful hold more. */
  huntHoldScale(member: Member): number {
    if (this.huntOn && member === this.huntWatcherMember) return squadConfig.huntWatchHoldScale;
    return this.careful ? squadConfig.huntCarefulHoldScale : 1;
  }

  /**
   * True when a grenade should be thrown (4.12, enemies.md "Grenades"): the tier throws, Rook has held one spot for the
   * tier's grenade hold (longer than the flank's, so a flank comes first), no flank and no throw is under way, the wait
   * is over, and the squad is not disorganised. `enemyGrenadeLive`: one is already in the air (one at a time).
   */
  grenadeDue(enemyGrenadeLive: boolean): boolean {
    if (this.tier.throwsGrenades <= 0 || enemyGrenadeLive || this.throwMember !== null || this.flankMembers.size > 0) return false;
    if (this.grenadeWaitLeftSec > 0 || this.disorganised) return false;
    return this.holdSec >= this.tier.holdBeforeGrenadeSec;
  }

  /**
   * Gives the throw to the candidate with the cheapest plan (the nearest one with a clear lob), or nobody; then it tries
   * again after the retry time, and `grenadeFailure` says why.
   */
  assignGrenade<M extends Member, P extends { readonly cost: number }>(candidates: readonly M[], plan: (member: M) => P | null): { member: M; plan: P } | null {
    const best = cheapestOf(candidates, plan);
    if (!best) {
      this.grenadeFailure = candidates.length > 0 ? 'no clear lob in range' : 'nobody can throw (no grenade left, busy, or not in cover)';
      this.grenadeWaitLeftSec = enemyGrenadeConfig.throwRetrySec;
      return null;
    }
    this.grenadeFailure = null;
    this.throwMember = best.member;
    return best;
  }

  /** The thrower, or null. */
  get thrower(): Member | null {
    return this.throwMember;
  }

  /** Time before another throw may start. For the dev readout. */
  get grenadeWaitSec(): number {
    return this.grenadeWaitLeftSec;
  }

  /** The throw by `member` is over: thrown (the cooldown starts) or not (Rook moved, it was hurt: it tries again soon). */
  grenadeOver(member: Member, thrown: boolean): void {
    if (member !== this.throwMember) return;
    this.throwMember = null;
    this.grenadeWaitLeftSec = thrown ? this.tier.grenadeCooldownSec : enemyGrenadeConfig.throwRetrySec;
  }

  /** Dev panel testing aid: a throw is due now (if the tier throws and nobody is throwing or flanking). */
  forceGrenade(): void {
    this.holdSec = Math.max(this.holdSec, this.tier.holdBeforeGrenadeSec);
    this.grenadeWaitLeftSec = 0;
  }

  /** Dev panel testing aid: a hunt is due now, once the squad's knowledge is old (not at a tier that never hunts). */
  forceHunt(): void {
    if (this.huntOn) return;
    this.staleSec = Math.max(this.staleSec, this.tier.huntAfterSec);
    this.huntSpent = false;
    this.careful = false;
    this.huntRetryLeftSec = 0;
  }

  /** Dev panel testing aid: a suppress-and-advance play may start now (if Rook hides and nothing else is on). */
  forcePlay(): void {
    this.playWaitLeftSec = 0;
  }

  /** Dev panel testing aid: a flank is due now (if nobody is flanking). */
  forceFlank(): void {
    this.holdSec = Math.max(this.holdSec, this.tier.holdBeforeFlankSec);
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
    this.flankMembers.clear();
    this.flankWaitLeftSec = 0;
    this.disorderLeftSec = 0;
    this.suppressMember = null;
    this.advanceMembers.clear();
    this.repositionMember = null;
    this.playWaitLeftSec = this.tier.playEverySec;
    this.pushWindow = null;
    this.pushWindowLeftSec = 0;
    this.pushDelayLeftSec = 0;
    this.pushedThisWindow = false;
    this.pushIgnoredThisWindow = false;
    this.coverGraceLeftSec = 0;
    this.rookHidden = false;
    this.playFailure = null;
    this.endHunt();
    this.staleSec = 0;
    this.huntSpent = false;
    this.careful = false;
    this.huntRetryLeftSec = 0;
    this.huntFailure = null;
    this.huntResult = null;
    this.throwMember = null;
    this.grenadeWaitLeftSec = 0;
    this.grenadeFailure = null;
  }
}
