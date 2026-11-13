import { knifeConfig } from '../config/knife';
import { pistolConfig } from '../config/pistol';
import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import type { WeaponEvents, WeaponId } from './events';
import type { Gun } from './gun';
import type { Knife } from './knife';

/** The order the mouse wheel cycles through, and the order of keys 1, 2, 3. */
export const weaponOrder: readonly WeaponId[] = ['rifle', 'pistol', 'knife'];

const drawTimeSec = (weapon: WeaponId): number =>
  weapon === 'rifle' ? rifleConfig.drawTimeSec : weapon === 'pistol' ? pistolConfig.drawTimeSec : knifeConfig.drawTimeSec;

export interface WeaponSetInput {
  /** A weapon asked for by key, or null. */
  select: WeaponId | null;
  /** Mouse wheel steps this update: negative is up the list (knife to pistol to rifle), positive is down. */
  wheelSteps: number;
  triggerHeld: boolean;
  triggerPressed: boolean;
  reloadPressed: boolean;
  /** True once when R has been held long enough to check the magazine. */
  checkRequested: boolean;
  /** False while sprinting, climbing or vaulting. */
  canFire: boolean;
}

// Which weapon is out, and the draw time after taking one out. The other weapons keep their own state while away.
export class WeaponSet {
  current: WeaponId = 'rifle';
  private drawLeftSec = 0;
  private drawTotalSec = 1;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly rifle: Gun,
    private readonly pistol: Gun,
    private readonly knife: Knife,
  ) {}

  /** The gun in hand, or null when the knife is out. */
  get gun(): Gun | null {
    return this.current === 'rifle' ? this.rifle : this.current === 'pistol' ? this.pistol : null;
  }

  /** Dev panel testing aid: no gun uses ammo while on. */
  setInfiniteAmmo(on: boolean): void {
    this.rifle.infiniteAmmo = on;
    this.pistol.infiniteAmmo = on;
  }

  /** The rifle's heat, 0 to 100, even while it is not in hand (its smoke follows it). */
  get rifleHeat(): number {
    return this.rifle.heat;
  }

  /** How far through the draw we are, 0 to 1 (1 when done). The draw animation follows this. */
  get drawProgress(): number {
    return this.drawing ? 1 - this.drawLeftSec / this.drawTotalSec : 1;
  }

  get drawing(): boolean {
    return this.drawLeftSec > 0;
  }

  select(weapon: WeaponId): void {
    if (weapon === this.current) return;
    this.gun?.interrupt(); // weapons.md: reloads can be cancelled by switching, and so can a magazine check
    this.current = weapon;
    this.drawTotalSec = Math.max(drawTimeSec(weapon), 0.01);
    this.drawLeftSec = this.drawTotalSec;
    this.events.emit('weapon:switched', { weapon });
  }

  /** Every weapon back to its starting state, with the rifle drawn (instant restart). */
  reset(): void {
    this.rifle.reset();
    this.pistol.reset();
    this.knife.reset();
    this.current = 'rifle';
    this.redraw();
    this.events.emit('weapon:switched', { weapon: 'rifle' }); // so the weapon in view is drawn again
  }

  /** Draws the weapon in hand again, as after a grenade throw. No switch happens, so no switch sound. */
  redraw(): void {
    this.drawTotalSec = Math.max(drawTimeSec(this.current), 0.01);
    this.drawLeftSec = this.drawTotalSec;
  }

  /** Moves along the wheel order, wrapping around. */
  cycle(steps: number): void {
    const count = weaponOrder.length;
    const next = (((weaponOrder.indexOf(this.current) + steps) % count) + count) % count;
    this.select(weaponOrder[next]);
  }

  update(dtSec: number, input: WeaponSetInput): void {
    if (input.select) this.select(input.select);
    else if (input.wheelSteps !== 0) this.cycle(input.wheelSteps);

    this.drawLeftSec = Math.max(this.drawLeftSec - dtSec, 0);
    const ready = !this.drawing;
    const canFire = input.canFire && ready;

    // A gun that is not in hand still cools down.
    for (const holstered of [this.rifle, this.pistol]) if (holstered !== this.gun) holstered.tickHeat(dtSec);

    const gun = this.gun;
    if (gun) {
      gun.update(dtSec, {
        triggerHeld: input.triggerHeld,
        triggerPressed: input.triggerPressed,
        reloadPressed: input.reloadPressed && ready,
        checkRequested: input.checkRequested && ready,
        canFire,
      });
    } else {
      this.knife.update(dtSec, { triggerPressed: input.triggerPressed, canFire });
    }
  }
}
