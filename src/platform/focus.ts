// Reports the tab being hidden or the window losing focus, so the game can pause.
export function onFocusLost(callback: () => void): void {
  window.addEventListener('blur', callback);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) callback();
  });
}
