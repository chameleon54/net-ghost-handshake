// Aggression tiers (milestone 4.11, decisions 30 and 240; enemies.md "Aggression level"). One level on the squad decides
// which tactics it may use. In Squad Waves the wave number will raise it (7.1); the story mission will set one per area.
// Until then the dev panel picks it. Starting values. Units are in the names; a 0 or 1 value is off or on. "Everyone who
// can" is any number at least the squad size (8 is the largest squad, enemies.md "Endless scaling"). The hunt values
// (decision 235): whether the squad comes looking once its knowledge of Rook is old, how long after, how many follow the
// hunt's leader per step, and how often a step comes.
export type Tier = 'cautious' | 'assertive' | 'aggressive' | 'relentless';

export const aggressionConfigDefaults = {
  /** Holds cover, peeks and fires, and sends the occasional flanker. No suppressing fire at all (decision 207). Never hunts. */
  cautious: {
    suppression: 0,
    playEverySec: 10,
    playMovers: 1,
    holdBeforeFlankSec: 12,
    flankWaitSec: 20,
    pincer: 0,
    hearChance: 0,
    pushMoversDry: 2,
    pushMoversReload: 1,
    pushMoversJam: 1,
    hunt: 0,
    huntAfterSec: 10,
    huntFollowers: 1,
    huntStepEverySec: 5,
  },
  /** Suppress and advance: one pins Rook's cover while another moves up. Reacts to his gun half the time. */
  assertive: {
    suppression: 1,
    playEverySec: 10,
    playMovers: 1,
    holdBeforeFlankSec: 8,
    flankWaitSec: 12,
    pincer: 0,
    hearChance: 0.5,
    pushMoversDry: 2,
    pushMoversReload: 1,
    pushMoversJam: 1,
    hunt: 1,
    huntAfterSec: 10,
    huntFollowers: 1,
    huntStepEverySec: 5,
  },
  /** Pincer: two flank at once, one round each side of him. Reacts to his gun every time. */
  aggressive: {
    suppression: 1,
    playEverySec: 8,
    playMovers: 1,
    holdBeforeFlankSec: 6,
    flankWaitSec: 10,
    pincer: 1,
    hearChance: 1,
    pushMoversDry: 2,
    pushMoversReload: 1,
    pushMoversJam: 1,
    hunt: 1,
    huntAfterSec: 5,
    huntFollowers: 2,
    huntStepEverySec: 4,
  },
  /** Coordinated push: everyone who can moves up cover by cover but one suppressor; piles in when his gun goes quiet. Hunts at once. */
  relentless: {
    suppression: 1,
    playEverySec: 5,
    playMovers: 8,
    holdBeforeFlankSec: 5,
    flankWaitSec: 8,
    pincer: 1,
    hearChance: 1,
    pushMoversDry: 8,
    pushMoversReload: 2,
    pushMoversJam: 2,
    hunt: 1,
    huntAfterSec: 0,
    huntFollowers: 8,
    huntStepEverySec: 3,
  },
} as const;

/** One tier's values (see the table in enemies.md). */
export type TierValues = { -readonly [K in keyof (typeof aggressionConfigDefaults)['cautious']]: number };

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export const aggressionConfig: Record<Tier, TierValues> = {
  cautious: { ...aggressionConfigDefaults.cautious },
  assertive: { ...aggressionConfigDefaults.assertive },
  aggressive: { ...aggressionConfigDefaults.aggressive },
  relentless: { ...aggressionConfigDefaults.relentless },
};

export const tiers: readonly Tier[] = ['cautious', 'assertive', 'aggressive', 'relentless'];

/** The tier the squad fights at now. The test arena starts on Assertive (decision 240); the dev panel switches it. */
export const aggressionSetting: { current: Tier } = { current: 'assertive' };
