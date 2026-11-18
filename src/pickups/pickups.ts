import { gunOfRole, magazineFits } from '../config/enemyGuns';
import { pickupConfig } from '../config/pickups';
import type { Role } from '../config/roles';
import type { EventBus } from '../core/events';
import type { PickupKind, WeaponEvents } from '../weapons/events';

/** One item lying on the floor. */
export interface PickupItem {
  readonly kind: PickupKind;
  readonly xM: number;
  readonly zM: number;
  /** The floor's height where it lies. */
  readonly yM: number;
}

/** Takes an item for Rook: true if he could (a grenade only below his carry limit). */
export type TakeItem = (kind: PickupKind) => boolean;

// What dead contractors drop, and Rook picking it up by walking over it (milestone 4.12, decision 249; gameplay.md
// "Picking things up"). A body drops its grenade if it still carried one, and one full magazine that fits one of Rook's
// guns (a flanker's pistol magazine fits the P9, a trooper's or leader's rifle magazine the M4-A; the heavy's machine-gun
// ammo fits neither, weapons.md). Items stay until picked up or a restart. Rules only, no drawing (see pickupsView.ts).
export class Pickups {
  private readonly lying: PickupItem[] = [];

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly take: TakeItem,
  ) {
    events.on('enemy:downed', ({ position, role, grenades }) => this.drop(position.x, position.z, role, grenades, position.y));
  }

  /** What lies on the floor now. */
  get items(): readonly PickupItem[] {
    return this.lying;
  }

  /** A body at (x, z) drops its grenades and a magazine, side by side. */
  drop(xM: number, zM: number, role: Role, grenades: number, yM = 0): void {
    const spreadM = pickupConfig.dropSpreadM;
    for (let i = 0; i < grenades; i++) this.lying.push({ kind: 'grenade', xM: xM + spreadM * (i + 1), zM, yM });
    const magazine = magazineFits[gunOfRole[role]];
    if (magazine) this.lying.push({ kind: magazine, xM: xM - spreadM, zM, yM });
  }

  /** Once per game update: Rook takes every item within reach of his feet that he can carry. */
  update(feet: { readonly x: number; readonly y?: number; readonly z: number }): void {
    for (let i = this.lying.length - 1; i >= 0; i--) {
      const item = this.lying[i];
      if (Math.hypot(item.xM - feet.x, item.zM - feet.z) > pickupConfig.pickupRadiusM) continue;
      if (Math.abs(item.yM - (feet.y ?? 0)) > pickupConfig.pickupReachUpM) continue; // not through the floor above or below
      if (!this.take(item.kind)) continue; // he cannot carry it: it stays where it is
      this.lying.splice(i, 1);
      this.events.emit('pickup:taken', { kind: item.kind });
    }
  }

  /** Nothing on the floor (instant restart). */
  clear(): void {
    this.lying.length = 0;
  }
}
