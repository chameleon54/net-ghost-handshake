// What the player is holding right now. No browser code here; platform/inputListeners.ts feeds it.
// Keys are KeyboardEvent.code values ("KeyW"), which are positions, so WASD works on any layout.

export class Input {
  /** Input is ignored while the game is not playing (menu, paused). */
  enabled = false;

  private heldKeys = new Set<string>();
  private heldButtons = new Set<number>();
  private mouseDx = 0;
  private mouseDy = 0;

  keyDown(code: string): void {
    if (this.enabled) this.heldKeys.add(code);
  }

  // Key-ups always count, so a key released while paused is not left stuck.
  keyUp(code: string): void {
    this.heldKeys.delete(code);
  }

  buttonDown(button: number): void {
    if (this.enabled) this.heldButtons.add(button);
  }

  buttonUp(button: number): void {
    this.heldButtons.delete(button);
  }

  addMouseMove(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.mouseDx += dx;
    this.mouseDy += dy;
  }

  isKeyDown(code: string): boolean {
    return this.heldKeys.has(code);
  }

  isButtonDown(button: number): boolean {
    return this.heldButtons.has(button);
  }

  /** Mouse movement since the last call, in pixels. Writes into `out` so nothing is allocated per frame. */
  consumeMouseMove(out: { x: number; y: number }): void {
    out.x = this.mouseDx;
    out.y = this.mouseDy;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }

  /** Forget everything held. Called on pause so nothing sticks. */
  clear(): void {
    this.heldKeys.clear();
    this.heldButtons.clear();
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}
