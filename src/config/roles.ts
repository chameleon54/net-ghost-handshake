// Enemy roles (milestone 4.8, decision 228; enemies.md "Roles"). A role is an enemy's body and gear and never changes; the
// squad gives jobs (decision 217). Each role's values replace the shared stand-in values for these few things; everything
// else is shared. Starting values. Units are in the names. Guns and damage per role come in 4.12.
export type Role = 'trooper' | 'flanker' | 'heavy' | 'leader';

export const roleConfigDefaults = {
  /** The default: holds cover, peeks and fires steady bursts. */
  trooper: { healthPoints: 100, walkSpeedMps: 2.5, flankSpeedMps: 3.5, burstRounds: 3, preferMinM: 5, preferMaxM: 12 },
  /** Fast and fragile; gets the flank job first. */
  flanker: { healthPoints: 60, walkSpeedMps: 3.5, flankSpeedMps: 4.5, burstRounds: 3, preferMinM: 4, preferMaxM: 10 },
  /** Slow and tough, long bursts, likes close cover. A flank speed of 0 means it never flanks. */
  heavy: { healthPoints: 180, walkSpeedMps: 1.8, flankSpeedMps: 0, burstRounds: 6, preferMinM: 3, preferMaxM: 8 },
  /** Fights like a trooper; his death briefly disorganises the squad. */
  leader: { healthPoints: 100, walkSpeedMps: 2.5, flankSpeedMps: 3.5, burstRounds: 3, preferMinM: 5, preferMaxM: 12 },
} as const;

/** One role's values: health, walking and flank speed, rounds per burst, and the liked cover range (m from Rook). */
export type RoleValues = { -readonly [K in keyof (typeof roleConfigDefaults)['trooper']]: number };

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export const roleConfig: Record<Role, RoleValues> = {
  trooper: { ...roleConfigDefaults.trooper },
  flanker: { ...roleConfigDefaults.flanker },
  heavy: { ...roleConfigDefaults.heavy },
  leader: { ...roleConfigDefaults.leader },
};

export const roles: readonly Role[] = ['trooper', 'flanker', 'heavy', 'leader'];
