// The only file that talks to the Pointer Lock API (see CLAUDE.md: browser handling lives in platform/).

export interface PointerLock {
  /** Must be called from a click or key press; browsers refuse otherwise. */
  request(): Promise<void>;
  exit(): void;
}

export function createPointerLock(
  target: HTMLElement,
  onChange: (locked: boolean) => void,
  onRefused: () => void,
): PointerLock {
  document.addEventListener('pointerlockchange', () => onChange(document.pointerLockElement === target));
  document.addEventListener('pointerlockerror', onRefused);

  return {
    async request() {
      try {
        // Raw mouse movement (no OS acceleration) where the browser supports it.
        await target.requestPointerLock({ unadjustedMovement: true });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotSupportedError') {
          try {
            await target.requestPointerLock();
          } catch {
            onRefused();
          }
        } else {
          // Usually: Esc was pressed a moment ago and the browser has not allowed a new lock yet.
          onRefused();
        }
      }
    },
    exit() {
      document.exitPointerLock();
    },
  };
}

/**
 * While `when()` is true (the level editor is on, 5.2d), holding `button` on `target` captures the mouse, so the view can
 * turn without the cursor stopping at the screen edge, and letting go frees it again.
 */
export function captureWhileHeld(target: HTMLElement, button: number, lock: PointerLock, when: () => boolean): void {
  target.addEventListener('mousedown', (event) => {
    if (event.button === button && when() && document.pointerLockElement !== target) void lock.request();
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === button && when() && document.pointerLockElement === target) lock.exit();
  });
}
