import { healthFx } from '../config/healthFx';
import type { HealthFeelState } from '../player/healthFeel';

const vignetteColour = '140, 0, 0';
const flashColour = '200, 0, 0';
const roundTo = 100; // style values are rounded to two decimals so the page is only touched when something visibly changes

// Health shown through the screen (gameplay.md: there is no health bar): a red edge vignette that swells with each
// heartbeat, a red flash when hit, and the colour draining out of the picture. Plain HTML and CSS over the canvas.
export class HealthScreen {
  private readonly vignette = document.createElement('div');
  private readonly flash = document.createElement('div');
  private shown = { vignette: -1, flash: -1, drain: -1 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const layer = 'position:fixed;inset:0;pointer-events:none;opacity:0;';
    this.vignette.style.cssText = `${layer}background:radial-gradient(ellipse at center, transparent 40%, rgba(${vignetteColour}, 1) 130%)`;
    this.flash.style.cssText = `${layer}background:radial-gradient(ellipse at center, transparent 20%, rgba(${flashColour}, 1) 120%)`;
    document.body.append(this.vignette, this.flash);
  }

  /** Once per game update, after the feel is updated. */
  update(feel: HealthFeelState): void {
    const vignette = Math.min(feel.vignette * (1 + healthFx.pulseDepth * feel.pulse), 1);
    const round = (value: number): number => Math.round(value * roundTo) / roundTo;
    if (round(vignette) !== this.shown.vignette) {
      this.shown.vignette = round(vignette);
      this.vignette.style.opacity = String(this.shown.vignette);
    }
    if (round(feel.flash) !== this.shown.flash) {
      this.shown.flash = round(feel.flash);
      this.flash.style.opacity = String(this.shown.flash);
    }
    if (round(feel.drain) !== this.shown.drain) {
      this.shown.drain = round(feel.drain);
      this.canvas.style.filter = this.shown.drain > 0 ? `saturate(${1 - this.shown.drain})` : '';
    }
  }
}
