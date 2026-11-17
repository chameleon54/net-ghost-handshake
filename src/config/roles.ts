// Enemy roles (milestone 4.8, decision 228; enemies.md "Roles"). A role is an enemy's body and gear and never changes; the
// squad gives jobs (decision 217). Each role's values replace the shared stand-in values for these few things; everything
// else is shared. Starting values. Units are in the names. Since the flinch follow-up (decision 246): `runSpeedMps` for
// every move between cover (the heavy stays slow: it fires on the move), and `flinchDamage`, the damage within the flinch
// window that makes it flinch. Since 4.12 (decision 249): `grenades` carried from each spawn (troopers and the leader
// one each, enemies.md "Grenades"). Its gun, and so its damage, is in enemyGuns.ts. Since 4.15 (decision 265):
// `accelMps2` and `brakeMps2`, how quickly it speeds up and slows down (the heavy is slower to start and stop).
export type Role = 'trooper' | 'flanker' | 'heavy' | 'leader';

export const roleConfigDefaults = {
  /** The default: holds cover, peeks and fires steady bursts. */
  trooper: { healthPoints: 100, walkSpeedMps: 2.5, runSpeedMps: 4, flankSpeedMps: 3.5, burstRounds: 3, preferMinM: 5, preferMaxM: 12, firesOnTheMove: 0, flinchDamage: 30, grenades: 1, accelMps2: 6, brakeMps2: 8 },
  /** Fast and fragile; gets the flank job first. */
  flanker: { healthPoints: 60, walkSpeedMps: 3.5, runSpeedMps: 4.5, flankSpeedMps: 4.5, burstRounds: 3, preferMinM: 4, preferMaxM: 10, firesOnTheMove: 0, flinchDamage: 30, grenades: 0, accelMps2: 6, brakeMps2: 8 },
  /**
   * Slow and tough, long bursts, likes close cover. A flank speed of 0 means it never flanks. It fires while it moves
   * (`firesOnTheMove` 1, decision 237), so it needs no one else's covering fire.
   */
  heavy: { healthPoints: 180, walkSpeedMps: 1.8, runSpeedMps: 1.8, flankSpeedMps: 0, burstRounds: 6, preferMinM: 3, preferMaxM: 8, firesOnTheMove: 1, flinchDamage: 60, grenades: 0, accelMps2: 4, brakeMps2: 6 },
  /** Fights like a trooper; his death briefly disorganises the squad. */
  leader: { healthPoints: 100, walkSpeedMps: 2.5, runSpeedMps: 4, flankSpeedMps: 3.5, burstRounds: 3, preferMinM: 5, preferMaxM: 12, firesOnTheMove: 0, flinchDamage: 30, grenades: 1, accelMps2: 6, brakeMps2: 8 },
} as const;

/** One role's values: health, walking, running and flank speed, rounds per burst, the liked cover range (m from Rook), and so on. */
export type RoleValues = { -readonly [K in keyof (typeof roleConfigDefaults)['trooper']]: number };

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export const roleConfig: Record<Role, RoleValues> = {
  trooper: { ...roleConfigDefaults.trooper },
  flanker: { ...roleConfigDefaults.flanker },
  heavy: { ...roleConfigDefaults.heavy },
  leader: { ...roleConfigDefaults.leader },
};

export const roles: readonly Role[] = ['trooper', 'flanker', 'heavy', 'leader'];
