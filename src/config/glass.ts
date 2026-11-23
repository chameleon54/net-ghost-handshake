// Breakable glass (milestone 5.4, level.md "Breakable glass"). Starting values, to be readjusted by feel. Units are in the names.
export const glassConfig = {
  /** Bullets that hit an intact pane before it shatters (decision 283). Every bullet passes through; a blast shatters at once. */
  hitsToBreak: 3,
  /**
   * What an enemy's *hit* shot does when an intact pane is in its line. True: it still hurts Rook (the glass is no protection).
   * False: the shot only cracks the glass and does no damage (the owner may switch to this later, decision 283).
   */
  enemyHitsLandThroughGlass: true,
  /** How far the noise of a pane shattering carries (like a bullet impact; enemies hear it, decision 179). */
  breakNoiseM: 15,
  /** A crack mark's size for the first hit, then each later one (the last entry is used if a pane takes more hits than entries). */
  crackRadiusM: [0.18, 0.35],
  /** Spokes in a crack mark, per hit in the same way. */
  crackSpokes: [6, 12],
  /** Shards flung when a pane shatters: how many per burst, how many bursts can be alive at once (the oldest is reused). */
  shardsPerBurst: 40,
  maxShardBursts: 6,
  shardSizeM: 0.07,
  shardSpeedMps: 2.5,
  shardLifeSec: 1.4,
};
