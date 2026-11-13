// Placeholder overlay: one line of text over a dark layer. Clicking it asks to capture the mouse.
export interface Overlay {
  show(message: string): void;
  hide(): void;
}

export function createOverlay(onClick: () => void): Overlay {
  const element = document.createElement('div');
  element.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.6);color:#fff;font:24px system-ui,sans-serif;cursor:pointer;user-select:none';
  element.addEventListener('click', onClick);
  document.body.appendChild(element);

  return {
    show(message) {
      element.textContent = message;
      element.style.display = 'flex';
    },
    hide() {
      element.style.display = 'none';
    },
  };
}
