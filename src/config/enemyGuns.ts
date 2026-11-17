import type { GunId } from '../weapons/events';
import type { Role } from './roles';

// Enemy guns (milestone 4.12, decision 249; enemies.md "Weapons and damage"). Damage comes from the gun, not the role, and
// the gun is visible so the player can read the threat. The gun decides the damage, and since 4.16 (decision 266) its
// magazine and reload time; rounds per burst and their timing stay on the role (roles.ts). Starting values.
export type EnemyGun = 'pistol' | 'rifle' | 'lmg';

export const enemyGunConfigDefaults = {
  /** Flankers: the least lethal gun in the game, the same class as Rook's P9. */
  pistol: { damagePerHit: 8, magazineRounds: 15, reloadSec: 2 },
  /** Troopers and the squad leader: the same class as Rook's M4-A. */
  rifle: { damagePerHit: 15, magazineRounds: 30, reloadSec: 2.5 },
  /** Heavies: the light machine gun, lower per hit but far more shots. */
  lmg: { damagePerHit: 12, magazineRounds: 100, reloadSec: 5 },
} as const;

/** One gun's values. */
export type EnemyGunValues = { -readonly [K in keyof (typeof enemyGunConfigDefaults)['rifle']]: number };

/** The live values the game reads. The debug panel (dev server only) changes these; Reset puts the defaults above back. */
export const enemyGunConfig: Record<EnemyGun, EnemyGunValues> = {
  pistol: { ...enemyGunConfigDefaults.pistol },
  rifle: { ...enemyGunConfigDefaults.rifle },
  lmg: { ...enemyGunConfigDefaults.lmg },
};

export const enemyGuns: readonly EnemyGun[] = ['pistol', 'rifle', 'lmg'];

/** Which gun each role carries. A role's gear never changes (decision 228). */
export const gunOfRole: Record<Role, EnemyGun> = { trooper: 'rifle', flanker: 'pistol', heavy: 'lmg', leader: 'rifle' };

/** Which of Rook's guns a dead contractor's magazine fits (weapons.md), or null: the machine gun's ammo fits neither. */
export const magazineFits: Record<EnemyGun, GunId | null> = { pistol: 'pistol', rifle: 'rifle', lmg: null };
