// Hit points. No drawing code, so it can be tested alone. Enemies will use it too.
export class Health {
  current: number;

  constructor(readonly max: number) {
    this.current = max;
  }

  get dead(): boolean {
    return this.current <= 0;
  }

  /** Takes damage. Returns true if this hit is the one that killed. Does nothing once dead. */
  damage(amount: number): boolean {
    if (this.dead) return false;
    this.current = Math.max(this.current - amount, 0);
    return this.dead;
  }

  /** Kills at once (a headshot). Returns true if it killed, false if already dead. */
  kill(): boolean {
    if (this.dead) return false;
    this.current = 0;
    return true;
  }
}
