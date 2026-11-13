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
export class Game {
  readonly events = new EventBus<GameEvents>();
  state: PlayState = 'menu';

  constructor(
    private readonly input: Input,
    private readonly releaseMouse: () => void,
  ) {}

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** Called by the pointer lock when the capture starts or stops. */
  handleLockChange(locked: boolean): void {
    if (locked) {
      this.state = 'playing';
      this.input.enabled = true;
      this.events.emit('game:playing', undefined);
    } else if (this.state === 'playing') {
      this.pause('lock-lost');
    }
  }

  handleFocusLost(): void {
    if (this.state !== 'playing') return;
    this.pause('focus-lost');
    this.releaseMouse();
  }

  handleCaptureRefused(): void {
    this.events.emit('game:capture-refused', undefined);
  }

  private pause(reason: PauseReason): void {
    this.state = 'paused';
    this.input.enabled = false;
    this.input.clear();
    this.events.emit('game:paused', { reason });
  }
}
