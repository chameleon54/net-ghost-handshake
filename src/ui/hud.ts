import { Vector3, type Camera } from 'three';
import { healthFx } from '../config/healthFx';
import type { EventBus } from '../core/events';
import { uiText } from '../data/uiText';
import type { MagazineCheck } from '../weapons/magazineFeel';
import { fillShare } from '../weapons/magazineFeel';
import type { WeaponEvents } from '../weapons/events';
import type { WeaponSet } from '../weapons/weaponSet';

// The minimal HUD (ui.md): a crosshair dot and hit marker, and a few quiet items that appear only when they matter and
// then fade: the weapon name on switching, the grenade and heal counts, the jam prompt, the magazine pictures, and the
// damage direction arc after an enemy's hit. It never shows a bullet count and never shows health (the screen does, see
// healthScreen.ts).
const crosshairSizePx = 4;
const hitMarkerFadeMs = 150;
const hitColour = '#ffffff';
const killColour = '#ff4444';
const textColour = '#ffffff';
const accentColour = '#8fd3ff'; // the one accent colour (ui.md leaves the final choice open)
const marginPx = 16;
const pictureWidthPx = 12;
const pictureHeightPx = 32;
const msPerSec = 1000;
const arcSizePx = 180; // the damage direction arc is a quarter of a ring this wide, around the crosshair
const arcWidthPx = 4;
const arcColour = '#ff4444';

/** Where the magazine in the gun is on screen, as a point from -1 to 1 on each axis. The viewmodel knows. */
export interface MagazineLocator {
  magazineScreen(out: { x: number; y: number }): boolean;
}

export interface HudState {
  weapons: WeaponSet;
  /** 0 hip, 1 aimed. The crosshair dot hides while aiming. */
  aimBlend: number;
  grenades: number;
  heals: number;
  /** True while a heal item is being used. */
  healing: boolean;
  /** The game camera: where Rook is and looks, for the damage direction arc. */
  camera: Camera;
}

export interface Hud {
  /** Once per screen frame. */
  update(state: HudState): void;
}

interface PopUp {
  element: HTMLDivElement;
  untilMs: number;
  text: string;
  opacity: number;
}

/** One magazine drawn as a small outline, filled white from the bottom by `fill` (0 to 1), or empty when `fill` is null. */
function magazinePicture(fill: number | null): HTMLDivElement {
  const picture = document.createElement('div');
  picture.style.cssText =
    `position:relative;overflow:hidden;width:${pictureWidthPx}px;height:${pictureHeightPx}px;` +
    `border:1px solid ${textColour};border-radius:2px;box-sizing:border-box;opacity:0.9`;
  if (fill !== null && fill > 0) {
    const level = document.createElement('div');
    level.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:${fill * 100}%;background:${textColour}`;
    picture.appendChild(level);
  }
  return picture;
}

export function createHud(events: EventBus<WeaponEvents>, locator: MagazineLocator): Hud {
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

  // The damage direction arc (ui.md, decision 201): after an enemy's hit, a red quarter ring around the crosshair points
  // toward where the shot came from (top is ahead), follows as Rook turns, and fades.
  const arc = document.createElement('div');
  arc.style.cssText =
    `position:fixed;left:50%;top:50%;width:${arcSizePx}px;height:${arcSizePx}px;margin:${-arcSizePx / 2}px 0 0 ${-arcSizePx / 2}px;` +
    `border-radius:50%;border:${arcWidthPx}px solid transparent;border-top-color:${arcColour};box-sizing:border-box;` +
    'filter:drop-shadow(0 0 2px #000);pointer-events:none;opacity:0';
  document.body.appendChild(arc);
  const arcFrom = { x: 0, z: 0, atMs: -Infinity };
  const look = new Vector3();
  events.on('player:damaged', ({ from }) => {
    if (!from) return;
    arcFrom.x = from.x;
    arcFrom.z = from.z;
    arcFrom.atMs = performance.now();
  });

  // Bottom right: the magazine pictures above a column of quiet text lines.
  const corner = document.createElement('div');
  corner.style.cssText =
    `position:fixed;right:${marginPx}px;bottom:${marginPx}px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;` +
    `color:${textColour};font:300 15px system-ui,sans-serif;letter-spacing:0.04em;text-shadow:0 0 3px #000;pointer-events:none;user-select:none`;
  const pictures = document.createElement('div');
  pictures.style.cssText = 'display:flex;gap:4px;align-items:flex-end';
  corner.appendChild(pictures);
  const makePopUp = (colour: string): PopUp => {
    const element = document.createElement('div');
    element.style.cssText = `color:${colour};opacity:0`;
    corner.appendChild(element);
    return { element, untilMs: 0, text: '', opacity: 0 };
  };
  const weaponLine = makePopUp(textColour);
  const grenadeLine = makePopUp(textColour);
  const healLine = makePopUp(textColour);
  const jamLine = makePopUp(accentColour);
  document.body.appendChild(corner);

  // The gun's own magazine floats beside the gun while checking, following the magazine on screen.
  const floating = document.createElement('div');
  floating.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;opacity:0';
  document.body.appendChild(floating);

  const showFor = (item: PopUp, sec: number): void => {
    item.untilMs = Math.max(item.untilMs, performance.now() + sec * msPerSec);
  };
  events.on('weapon:switched', () => showFor(weaponLine, healthFx.hudShowSec));
  events.on('grenade:pin', () => showFor(grenadeLine, healthFx.hudShowSec));
  events.on('heal:started', () => showFor(healLine, healthFx.hudShowSec));
  events.on('player:healed', () => showFor(healLine, healthFx.hudShowSec));

  // The magazine pictures: a check shows how full each is (in rough steps); a reload shows only how many spares there are.
  let checked: { check: MagazineCheck; untilMs: number } | null = null;
  let reloadUntilMs = 0;
  events.on('weapon:magazine-checked', ({ check }) => {
    checked = { check, untilMs: performance.now() + healthFx.magazinePictureShowSec * msPerSec };
  });
  events.on('weapon:reload-started', () => {
    reloadUntilMs = performance.now() + healthFx.magazinePictureShowSec * msPerSec;
  });
  let picturesKey = '';
  const locatorOut = { x: 0, y: 0 };

  /** Fades an item out over `hudFadeSec` at the end of its time, and only touches the page when something changed. */
  const render = (item: PopUp, text: string, nowMs: number, always = false): void => {
    const leftMs = always ? Infinity : item.untilMs - nowMs;
    const opacity = leftMs <= 0 ? 0 : Math.round(Math.min(leftMs / Math.max(healthFx.hudFadeSec * msPerSec, 1), 1) * 100) / 100;
    if (text !== item.text) {
      item.text = text;
      item.element.textContent = text;
    }
    if (opacity !== item.opacity) {
      item.opacity = opacity;
      item.element.style.opacity = String(opacity);
    }
  };

  return {
    update({ weapons, aimBlend, grenades, heals, healing, camera }) {
      const nowMs = performance.now();
      dot.style.opacity = String(1 - aimBlend);

      const arcOpacity = Math.max(1 - (nowMs - arcFrom.atMs) / Math.max(healthFx.damageArcSec * msPerSec, 1), 0);
      if (arcOpacity > 0) {
        camera.getWorldDirection(look);
        const toX = arcFrom.x - camera.position.x;
        const toZ = arcFrom.z - camera.position.z;
        // Right of where he looks is (-look.z, look.x); the angle is 0 ahead and grows clockwise, like CSS rotate.
        const angleRad = Math.atan2(toX * -look.z + toZ * look.x, toX * look.x + toZ * look.z);
        arc.style.transform = `rotate(${angleRad}rad)`;
      }
      if (arc.style.opacity !== String(arcOpacity)) arc.style.opacity = String(arcOpacity);

      // Heals stay up while one is being used.
      if (healing) showFor(healLine, healthFx.hudShowSec);
      const gun = weapons.gun;
      render(weaponLine, uiText.weaponNames[weapons.current], nowMs);
      render(grenadeLine, `${uiText.grenades}: ${grenades}`, nowMs);
      render(healLine, `${uiText.heals}: ${heals}${healing ? `   ${uiText.healing}` : ''}`, nowMs);
      render(jamLine, uiText.jammed, nowMs, gun?.jammed ?? false);
      if (!(gun?.jammed ?? false)) jamLine.untilMs = 0;

      // The pictures. A check wins over a reload while it lasts.
      // The pictures stay for as long as the check lasts (R may be held), and fade a few seconds after it ends.
      if (checked !== null && (gun?.checking ?? false) && nowMs < checked.untilMs) checked.untilMs = nowMs + healthFx.magazinePictureShowSec * msPerSec;
      const checking = checked !== null && nowMs < checked.untilMs ? checked.check : null;
      const reloading = checking === null && gun !== null && nowMs < reloadUntilMs;
      const spares = checking ? checking.spares.map((spare) => fillShare(spare.feel)) : reloading && gun ? Array.from({ length: gun.magazines.spareCount }, () => null) : [];
      const key = `${checking ? 'c' : reloading ? 'r' : '-'}:${spares.length}:${spares.join(',')}`;
      if (key !== picturesKey) {
        picturesKey = key;
        pictures.replaceChildren(...spares.map((fill) => magazinePicture(fill)));
      }
      const gunFill = checking ? fillShare(checking.gun.feel) : null;
      if (gunFill !== null && (gun?.checking ?? false) && locator.magazineScreen(locatorOut)) {
        floating.style.opacity = '1';
        const x = (locatorOut.x * 0.5 + 0.5) * window.innerWidth;
        const y = (0.5 - locatorOut.y * 0.5) * window.innerHeight - pictureHeightPx / 2;
        floating.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        if (floating.dataset.fill !== String(gunFill)) {
          floating.dataset.fill = String(gunFill);
          floating.replaceChildren(magazinePicture(gunFill));
        }
      } else {
        floating.style.opacity = '0';
      }
    },
  };
}
