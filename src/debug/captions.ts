import type { SoundName } from '../audio/recipes';
import type { PlayOptions } from '../audio/soundPlayer';

// Dev-only sound captions: a few lines on screen saying which sound was played, so placeholder sounds can be checked by
// eye. Loaded by the dev server only.
const maxLines = 4;
const lineLifeSec = 1.5;

/** One caption line for a sound: its name, what it was for (the note), how loud and how fast, and where. */
export function formatCaption(name: SoundName, options: PlayOptions, audible: boolean): string {
  const parts: string[] = [name];
  if (options.note) parts.push(options.note);
  parts.push(`vol ${(options.volume ?? 1).toFixed(2)}`);
  parts.push(`rate ${(options.rate ?? 1).toFixed(2)}`);
  parts.push(options.position ? 'positional' : 'centred');
  if (!audible) parts.push('NOT AUDIBLE: sound not started');
  return parts.join('  |  ');
}

interface Line {
  text: string;
  ageSec: number;
}

/** The newest few captions, each gone after a moment. No page code, so it can be tested. */
export class CaptionList {
  private lines: Line[] = [];

  add(text: string): void {
    this.lines.push({ text, ageSec: 0 });
    if (this.lines.length > maxLines) this.lines.shift();
  }

  update(dtSec: number): void {
    for (const line of this.lines) line.ageSec += dtSec;
    this.lines = this.lines.filter((line) => line.ageSec < lineLifeSec);
  }

  /** The captions to show, oldest first, with how opaque each is (fading over its last third). */
  visible(): { text: string; opacity: number }[] {
    return this.lines.map((line) => ({ text: line.text, opacity: Math.min((lineLifeSec - line.ageSec) / (lineLifeSec / 3), 1) }));
  }

  clear(): void {
    this.lines = [];
  }
}

/** The captions drawn at the bottom centre of the screen. */
export class CaptionView {
  private readonly element = document.createElement('div');
  private shown = '';

  constructor() {
    this.element.style.cssText =
      'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;' +
      'font:12px ui-monospace,Consolas,monospace;color:#cfe8ff;text-shadow:0 0 3px #000;pointer-events:none;user-select:none';
    document.body.appendChild(this.element);
  }

  show(list: CaptionList): void {
    const lines = list.visible();
    const key = lines.map((l) => `${l.text}#${l.opacity.toFixed(2)}`).join('\n');
    if (key === this.shown) return; // only touch the page when something changed
    this.shown = key;
    this.element.replaceChildren(
      ...lines.map(({ text, opacity }) => {
        const div = document.createElement('div');
        div.textContent = text;
        div.style.opacity = String(opacity);
        return div;
      }),
    );
  }
}
