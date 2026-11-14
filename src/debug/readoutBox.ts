// Dev-only readouts on the screen, top left (free of the HUD, the captions and the tuning panel): plain lines of text,
// each shown in full. They used to be rows in the 320 px panel, which cut the long ones off. A panel tick hides them.
export class ReadoutBox {
  shown = true;
  private readonly element = document.createElement('pre');
  private text = '';

  constructor() {
    this.element.style.cssText =
      'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;max-width:calc(100vw - 360px);overflow:hidden;' +
      'font:11px/1.35 ui-monospace,Consolas,monospace;color:#d8f3ff;background:rgba(0,0,0,0.55);border-radius:3px;' +
      'white-space:pre-wrap;pointer-events:none;user-select:none;z-index:10';
    document.body.appendChild(this.element);
  }

  /** Shows these lines (only touches the page when something changed). */
  show(lines: readonly string[]): void {
    this.element.style.display = this.shown ? 'block' : 'none';
    const text = lines.join('\n');
    if (text === this.text) return;
    this.text = text;
    this.element.textContent = text;
  }
}
