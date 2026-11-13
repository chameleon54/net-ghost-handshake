import type { Rifle } from '../weapons/rifle';

// TEMPORARY (milestone 2.1): a crosshair dot and a line of ammo text so reloading can be checked.
// The real HUD comes in milestone 3 and never shows a bullet count; this one does, for testing only.
const crosshairSizePx = 4;

export interface WeaponReadout {
  update(rifle: Rifle): void;
}

export function createWeaponReadout(): WeaponReadout {
  const dot = document.createElement('div');
  dot.style.cssText =
    `position:fixed;left:50%;top:50%;width:${crosshairSizePx}px;height:${crosshairSizePx}px;` +
    'margin:-2px 0 0 -2px;border-radius:50%;background:#fff;box-shadow:0 0 2px #000;pointer-events:none';
  document.body.appendChild(dot);

  const text = document.createElement('div');
  text.style.cssText =
    'position:fixed;right:16px;bottom:16px;color:#fff;font:16px system-ui,sans-serif;' +
    'text-shadow:0 0 3px #000;pointer-events:none;user-select:none';
  document.body.appendChild(text);

  let shown = '';
  return {
    update(rifle) {
      const { loadedRounds, spareCount, capacityRounds } = rifle.magazines;
      const state = rifle.reloading ? ' RELOADING' : loadedRounds === 0 ? ' EMPTY' : '';
      const next = `Mags: ${spareCount}  (${loadedRounds}/${capacityRounds})${state}`;
      if (next === shown) return; // only touch the page when the text changes
      shown = next;
      text.textContent = next;
    },
  };
}
