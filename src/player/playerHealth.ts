import { difficultySetting } from '../config/difficulty';
import { healthConfig } from '../config/health';
import type { Vector3 } from 'three';
import type { EventBus } from '../core/events';
import { Health } from '../enemies/health';
import type { WeaponEvents } from '../weapons/events';

export type DamageSource = 'blast' | 'fall' | 'hazard' | 'enemy' | 'debug';

const regenRateKeys = { easy: 'regenPerSecEasy', normal: 'regenPerSecNormal', hard: 'regenPerSecHard' } as const;

// Rook's hit points. It only decides what happens and says so through events (`player:damaged`, `player:died`,
// `player:healed`). After a quiet moment health climbs back, but only up to the regeneration ceiling (50); a heal
// item is the only way higher. The screen effects come in 3.3. No drawing code here.
export class PlayerHealth {
  /** Dev panel testing aid: no damage is taken while on. */
  invulnerable = false;
  private health = new Health(healthConfig.maxHealth);
  private sinceDamageSec = Infinity;
  /** Set by the dev panel's health slider so the value stays put until real damage, a heal or a restart. */
  private regenHeld = false;

  constructor(private readonly events: EventBus<WeaponEvents>) {}

  get current(): number {
    return this.health.current;
  }

  get dead(): boolean {
    return this.health.dead;
  }

  /** True at full health: a heal item would be wasted. */
  get full(): boolean {
    return this.health.current >= this.health.max;
  }

  /** True while health is climbing back by itself. For the dev readout. */
  get regenerating(): boolean {
    return !this.dead && !this.regenHeld && this.sinceDamageSec >= healthConfig.regenDelaySec && this.current < healthConfig.regenCeiling;
  }

  /** `from`: where an enemy's shot came from, for the damage direction arc. */
  damage(amount: number, source: DamageSource, from?: Vector3): void {
    if (this.dead || this.invulnerable || amount <= 0) return;
    this.sinceDamageSec = 0;
    this.regenHeld = false;
    const killed = this.health.damage(amount);
    this.events.emit('player:damaged', { amount, health: this.health.current, source, from });
    if (killed) this.events.emit('player:died', { source });
  }

  /** A heal item's effect: adds `amount`, up to full health. */
  heal(amount: number): void {
    if (this.dead) return;
    const before = this.health.current;
    this.regenHeld = false;
    this.health.heal(amount);
    this.events.emit('player:healed', { amount: this.health.current - before, health: this.health.current });
  }

  /** Once per game update: after a quiet moment, health climbs toward the ceiling. */
  update(dtSec: number): void {
    this.sinceDamageSec += dtSec;
    if (!this.regenerating) return;
    this.health.heal(healthConfig[regenRateKeys[difficultySetting.current]] * dtSec, healthConfig.regenCeiling);
  }

  /** Dev panel testing aid: sets health to `value` directly, with no damage, events or death. */
  debugSet(value: number): void {
    if (this.dead) return;
    this.health.current = Math.min(Math.max(value, 1), this.health.max);
    this.regenHeld = true;
  }

  /** Back to full health (restart, and the dev panel's Heal full). */
  reset(): void {
    this.health = new Health(healthConfig.maxHealth);
    this.sinceDamageSec = Infinity;
    this.regenHeld = false;
  }
}
