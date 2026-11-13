// Tells a tap from a hold on one key. A tap (let go before `holdSec`) is reported when the key is released; a hold is
// reported once, the moment the key has been down for `holdSec`, and its release is not a tap. R uses it (tap reloads,
// hold checks the magazine) and so does F (hold inspects). No browser code here.
export class HoldTap {
  /** True for the one update in which a tap finished. */
  tapped = false;
  /** True for the one update in which the key reached the hold time. */
  holdStarted = false;

  private downSec = 0;
  private wasDown = false;
  private holdReported = false;

  update(dtSec: number, down: boolean, holdSec: number): void {
    this.tapped = false;
    this.holdStarted = false;
    if (down) {
      this.downSec = this.wasDown ? this.downSec + dtSec : 0;
      if (!this.holdReported && this.downSec >= holdSec) {
        this.holdReported = true;
        this.holdStarted = true;
      }
    } else if (this.wasDown && !this.holdReported) {
      this.tapped = true;
    }
    if (!down) this.holdReported = false;
    this.wasDown = down;
  }

  /** Forget a key that was down (when the game pauses), so resuming does not count as a tap. */
  reset(): void {
    this.tapped = false;
    this.holdStarted = false;
    this.downSec = 0;
    this.wasDown = false;
    this.holdReported = false;
  }
}
