import { EventBus } from './events';
import type { Input } from './input';

export type PlayState = 'menu' | 'playing' | 'paused';
export type PauseReason = 'lock-lost' | 'focus-lost';

export type GameEvents = {
  'game:playing': undefined;
  'game:paused': { reason: PauseReason };
  /** The browser refused to capture the mouse (for example, right after Esc). */
  'game:capture-refused': undefined;
};

// Rule: the game runs only while the mouse is captured. Losing the capture for any
// reason (Esc, alt-tab, a browser popup) pauses it, so there are no special cases.
// The one exception is the level editor (dev server only, 5.2d): it runs with a free cursor.
export class Game {
  readonly events = new EventBus<GameEvents>();
  state: PlayState = 'menu';
  private editingOn = false;
  private locked = false;

  constructor(
    private readonly input: Input,
    private readonly releaseMouse: () => void,
  ) {}

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** True while the level editor is on: the game runs with the mouse free, and the editor captures it only while looking. */
  get editing(): boolean {
    return this.editingOn;
  }

  /**
   * The level editor turns on (the game runs and the mouse is freed, so the panel can be used) or off (without the mouse
   * captured, the game pauses and a click resumes it, as after Esc).
   */
  setEditing(on: boolean): void {
    if (on === this.editingOn) return;
    this.editingOn = on;
    if (on) {
      this.state = 'playing';
      this.input.enabled = true;
      this.events.emit('game:playing', undefined);
      if (this.locked) this.releaseMouse();
    } else if (!this.locked && this.state === 'playing') {
      this.pause('lock-lost');
    }
  }

  /** Called by the pointer lock when the capture starts or stops. */
  handleLockChange(locked: boolean): void {
    this.locked = locked;
    if (locked) {
      this.state = 'playing';
      this.input.enabled = true;
      this.events.emit('game:playing', undefined);
    } else if (this.state === 'playing' && !this.editingOn) {
      this.pause('lock-lost');
    }
  }

  handleFocusLost(): void {
    if (this.state !== 'playing') return;
    if (this.editingOn) {
      this.input.clear(); // nothing stays held while the window is away; the editor stays on
      return;
    }
    this.pause('focus-lost');
    this.releaseMouse();
  }

  handleCaptureRefused(): void {
    if (this.editingOn) return; // looking in the editor works without the capture too
    this.events.emit('game:capture-refused', undefined);
  }

  private pause(reason: PauseReason): void {
    this.state = 'paused';
    this.input.enabled = false;
    this.input.clear();
    this.events.emit('game:paused', { reason });
  }
}
