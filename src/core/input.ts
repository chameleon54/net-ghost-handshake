// What the player is holding right now. No browser code here; platform/inputListeners.ts feeds it.
// Keys are KeyboardEvent.code values ("KeyW"), which are positions, so WASD works on any layout.

export class Input {
  /** Input is ignored while the game is not playing (menu, paused). */
  enabled = false;

  private heldKeys = new Set<string>();
  private pressedKeys = new Set<string>();
  private heldButtons = new Set<number>();
  private pressedButtons = new Set<number>();
  private wheelNotches = 0;
  private mouseDx = 0;
  private mouseDy = 0;

  keyDown(code: string): void {
    if (!this.enabled) return;
    if (!this.heldKeys.has(code)) this.pressedKeys.add(code);
    this.heldKeys.add(code);
  }

  /** True once per key press, even if the key was tapped and released between two updates. */
  consumePress(code: string): boolean {
    return this.pressedKeys.delete(code);
  }

  // Key-ups always count, so a key released while paused is not left stuck.
  keyUp(code: string): void {
    this.heldKeys.delete(code);
  }

  buttonDown(button: number): void {
    if (!this.enabled) return;
    if (!this.heldButtons.has(button)) this.pressedButtons.add(button);
    this.heldButtons.add(button);
  }

  /** True once per click, even if the button was pressed and released between two updates. */
  consumeButtonPress(button: number): boolean {
    return this.pressedButtons.delete(button);
  }

  /** Mouse wheel movement in notches (one click of a normal wheel is 1; negative is away from you). */
  addWheel(notches: number): void {
    if (this.enabled) this.wheelNotches += notches;
  }

  /** Whole wheel steps since the last call. A fraction (a smooth trackpad) is kept until it adds up to a step. */
  consumeWheelSteps(): number {
    const steps = Math.trunc(this.wheelNotches);
    this.wheelNotches -= steps;
    return steps;
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
    this.pressedKeys.clear();
    this.heldButtons.clear();
    this.pressedButtons.clear();
    this.wheelNotches = 0;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}
