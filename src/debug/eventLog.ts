// The debug log (dev server only, decision 260): a running record of what the AI decided and why, with clock times. Lines
// collect here and are sent to the dev server once a second, which writes them to `debug-log.txt` in the project folder
// (the plugin in vite.config.ts). The file starts fresh each time the page loads. F8 (or the panel button) adds a mark.

/** Where the dev server takes the lines (vite.config.ts). */
export const debugLogUrl = '/__debug-log';
/** Sent with the first batch of a page load: the dev server starts the file fresh. */
export const debugLogStartHeader = 'x-debug-log-start';
/** A frame slower than this gets a line (25 ms: under 40 fps). Only drives the log, so it lives here, not in config. */
export const slowFrameMs = 25;

/** What the last frame cost, for a slow-frame line (from the performance meter). */
export interface FrameCost {
  aiMs: number;
  rays: number;
  routes: number;
}

const whoWidth = 12;

/** "14:32:07.4" */
export function clockTime(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${Math.floor(date.getMilliseconds() / 100)}`;
}

export class EventLog {
  /** Also print each line in the browser console (a panel tick). */
  printToConsole = false;

  private pending: string[] = [];
  private started = false;
  private marks = 0;
  // The slowest frame of the current second, and how many others were slow: one line per second at most.
  private slowest: { at: Date; frameMs: number; cost: FrameCost } | null = null;
  private otherSlowFrames = 0;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.add('log', `session started ${this.now().toDateString()}`);
  }

  /** One line: who (an enemy's letter and role, "squad", "Rook", ...) and what happened. */
  add(who: string, text: string, at: Date = this.now()): void {
    const line = `${clockTime(at)}  ${who.padEnd(whoWidth)}${text}`;
    this.pending.push(line);
    if (this.printToConsole) console.log(line);
  }

  /** A mark the owner sets when something looks wrong ("look at mark 3"). Returns its number. */
  mark(): number {
    this.marks++;
    this.add('MARK', `--- MARK ${this.marks} ---`);
    return this.marks;
  }

  /** A frame took `frameMs`: kept if it is the slowest of this second. */
  slowFrame(frameMs: number, cost: FrameCost): void {
    if (frameMs <= slowFrameMs) return;
    if (this.slowest && frameMs <= this.slowest.frameMs) {
      this.otherSlowFrames++;
      return;
    }
    if (this.slowest) this.otherSlowFrames++;
    this.slowest = { at: this.now(), frameMs, cost: { ...cost } };
  }

  /**
   * Once a second: writes the second's slow-frame line, and hands every new line to `send` (with `fresh` true the first
   * time, so the file starts over). Nothing is sent when there is nothing new.
   */
  flush(send: (text: string, fresh: boolean) => void): void {
    if (this.slowest) {
      const { at, frameMs, cost } = this.slowest;
      const others = this.otherSlowFrames > 0 ? `, ${this.otherSlowFrames} more slow frame${this.otherSlowFrames > 1 ? 's' : ''} this second` : '';
      this.add('frame', `${frameMs.toFixed(0)} ms (AI ${cost.aiMs.toFixed(1)} ms, ${cost.rays} rays, ${cost.routes} routes)${others}`, at);
      this.slowest = null;
      this.otherSlowFrames = 0;
    }
    if (this.pending.length === 0) return;
    send(this.pending.join('\n') + '\n', !this.started);
    this.started = true;
    this.pending = [];
  }
}
