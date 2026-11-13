import { healthConfig } from '../config/health';
import type { EventBus } from '../core/events';
import { Health } from '../enemies/health';
import type { WeaponEvents } from '../weapons/events';

export type DamageSource = 'blast' | 'fall' | 'hazard' | 'debug';

// Rook's hit points. It only decides what happens and says so through events (`player:damaged`, `player:died`).
// Regeneration and heals come in 3.2; the screen effects in 3.3. No drawing code here.
export class PlayerHealth {
  /** Dev panel testing aid: no damage is taken while on. */
  invulnerable = false;
  private health = new Health(healthConfig.maxHealth);

  constructor(private readonly events: EventBus<WeaponEvents>) {}

  get current(): number {
    return this.health.current;
  }

  get dead(): boolean {
    return this.health.dead;
  }

  damage(amount: number, source: DamageSource): void {
    if (this.dead || this.invulnerable || amount <= 0) return;
    const killed = this.health.damage(amount);
    this.events.emit('player:damaged', { amount, health: this.health.current, source });
    if (killed) this.events.emit('player:died', { source });
  }

  /** Back to full health (restart, and the dev panel's Heal full). */
  reset(): void {
    this.health = new Health(healthConfig.maxHealth);
  }
}
