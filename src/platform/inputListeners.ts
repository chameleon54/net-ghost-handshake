import type { Input } from '../core/input';

// Browsers report the wheel in pixels (about 100 per notch), lines (about 3) or pages. Convert to notches.
const pixelsPerNotch = 100;
const linesPerNotch = 3;

function wheelNotches(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY / linesPerNotch;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return Math.sign(event.deltaY);
  return event.deltaY / pixelsPerNotch;
}

/** True while the player types in a text field (the dev panels' search boxes and fields): keys then go to the field, not the game. */
function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}

// Connects browser keyboard and mouse events to the Input state. Clicks and the wheel count only on the game's own
// `surface` (or while it holds the mouse), so using a panel with a free cursor (the level editor, 5.2d) does not reach the game.
export function attachInputListeners(input: Input, surface: HTMLElement): void {
  const onSurface = (event: Event) => event.target === surface || document.pointerLockElement === surface;
  window.addEventListener('keydown', (event) => {
    // Leave browser shortcuts alone (Ctrl+W and similar). Gameplay is never bound to Ctrl.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) return;
    if (typingIn(event.target)) return;
    input.keyDown(event.code);
    // Stops Space scrolling and Tab moving focus while playing. Esc is never blocked.
    if (input.enabled && event.code !== 'Escape') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => input.keyUp(event.code));
  document.addEventListener('mousemove', (event) => {
    input.addMouseMove(event.movementX, event.movementY);
    input.setPointer(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
  });
  window.addEventListener('mousedown', (event) => {
    if (onSurface(event)) input.buttonDown(event.button);
  });
  window.addEventListener('mouseup', (event) => input.buttonUp(event.button));
  // Right mouse aims, so its menu must not pop up while playing.
  window.addEventListener('contextmenu', (event) => {
    if (input.enabled) event.preventDefault();
  });
  window.addEventListener('wheel', (event) => {
    if (onSurface(event)) input.addWheel(wheelNotches(event));
  });
}
