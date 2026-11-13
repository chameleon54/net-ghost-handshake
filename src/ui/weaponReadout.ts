import type { EventBus } from '../core/events';
import { uiText } from '../data/uiText';
import type { WeaponEvents } from '../weapons/events';
import type { WeaponSet } from '../weapons/weaponSet';

// TEMPORARY (milestones 2.1 to 2.3): a crosshair dot, hit marker and a line of ammo text so weapons can be checked.
// The real HUD comes in milestone 3 and never shows a bullet count; this one does, for testing only.
const crosshairSizePx = 4;
const hitMarkerFadeMs = 150;
const hitColour = '#ffffff';
const killColour = '#ff4444';
const feelShownMs = 3000;

export interface WeaponReadout {
  /** `aimBlend`: 0 hip, 1 aimed. The crosshair dot hides while aiming. */
  update(weapons: WeaponSet, aimBlend: number): void;
}

export function createWeaponReadout(events: EventBus<WeaponEvents>): WeaponReadout {
  const dot = document.createElement('div');
  dot.style.cssText =
    `position:fixed;left:50%;top:50%;width:${crosshairSizePx}px;height:${crosshairSizePx}px;` +
    'margin:-2px 0 0 -2px;border-radius:50%;background:#fff;box-shadow:0 0 2px #000;pointer-events:none';
  document.body.appendChild(dot);

  // The hit marker: an X around the crosshair that fades fast. White for a hit, red for a kill.
  const marker = document.createElement('div');
  marker.textContent = '✕';
  marker.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:22px system-ui,sans-serif;' +
    'text-shadow:0 0 3px #000;pointer-events:none;opacity:0';
  document.body.appendChild(marker);
  events.on('target:hit', ({ killed }) => {
    marker.style.color = killed ? killColour : hitColour;
    marker.animate([{ opacity: 1 }, { opacity: 0 }], { duration: hitMarkerFadeMs });
  });

  const text = document.createElement('div');
  text.style.cssText =
    'position:fixed;right:16px;bottom:16px;color:#fff;font:16px system-ui,sans-serif;' +
    'text-shadow:0 0 3px #000;pointer-events:none;user-select:none';
  document.body.appendChild(text);

  // After checking the magazine the rough word stays up for a few seconds.
  let feelWord = '';
  let feelUntilMs = 0;
  events.on('weapon:magazine-checked', ({ feel }) => {
    feelWord = uiText.magazineFeel[feel];
    feelUntilMs = performance.now() + feelShownMs;
  });

  let shown = '';
  return {
    update(weapons, aimBlend) {
      dot.style.opacity = String(1 - aimBlend);
      const gun = weapons.gun;
      let next = uiText.weaponNames[weapons.current];
      if (gun) {
        const { loadedRounds, spareCount, capacityRounds } = gun.magazines;
        const state = gun.reloading ? ' RELOADING' : loadedRounds === 0 ? ' EMPTY' : '';
        next += `   Mags: ${spareCount}  (${loadedRounds}/${capacityRounds})${state}`;
      }
      if (performance.now() < feelUntilMs) next += `   Magazine: ${feelWord}`;
      if (next === shown) return; // only touch the page when the text changes
      shown = next;
      text.textContent = next;
    },
  };
}
