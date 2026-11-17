import * as THREE from 'three';
import type { CalloutKind } from '../weapons/events';

// Dev-only speech above enemies' heads (4.17, decision 269): each callout hook (`enemy:callout`) shows as a short line
// over the enemy who says it, for a moment, seen through walls, so a playtest shows who called what and when. The words
// are placeholders from dialogue.md's table; phase 6 replaces them with real lines and subtitles. Loaded by the dev
// server only.

/** How long a line stays up. A newer line from the same enemy replaces it. */
const lineLifeSec = 2;
/** The line's bottom edge this far above the enemy's head (above its letter label). */
const aboveHeadM = 0.75;
const lineHeightM = 0.28;
const texturePx = 48;
const paddingPx = 10;

const words: Record<CalloutKind, string> = {
  reloading: 'Reloading!',
  flank_start: 'Flanking!',
  suppress_start: 'Covering!',
  advance_start: 'Moving up!',
  player_dry: "He's dry, push!",
  player_jammed: "Weapon's down, go!",
  squadmate_down: 'Man down!',
  suppressed: 'Pinned!',
  player_lost: 'Lost him!',
  need_cover: 'Need cover!',
};

/** The placeholder line for a callout ("Flanking left!" with a side, as Rook sees it). */
export function calloutText(kind: CalloutKind, side?: 'left' | 'right'): string {
  return kind === 'flank_start' && side ? `Flanking ${side}!` : words[kind];
}

/** Each speaker's current line and how long it has been up. No drawing, so it can be tested. */
export class SpeechLines<Speaker> {
  private readonly lines = new Map<Speaker, { text: string; ageSec: number }>();

  say(speaker: Speaker, text: string): void {
    this.lines.set(speaker, { text, ageSec: 0 });
  }

  update(dtSec: number): void {
    for (const [speaker, line] of this.lines) {
      line.ageSec += dtSec;
      if (line.ageSec >= lineLifeSec) this.lines.delete(speaker);
    }
  }

  /** What `speaker` is saying now, or null. */
  textOf(speaker: Speaker): string | null {
    return this.lines.get(speaker)?.text ?? null;
  }

  clear(): void {
    this.lines.clear();
  }
}

/** One line of white text on a dark band, drawn to a texture as wide as the text needs. */
function lineTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = `bold ${texturePx * 0.7}px system-ui, sans-serif`;
  if (context) context.font = font;
  canvas.width = Math.ceil((context?.measureText(text).width ?? text.length * texturePx * 0.5) + 2 * paddingPx);
  canvas.height = texturePx;
  if (context) {
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = font; // resizing the canvas resets it
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#fff';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  return { texture: new THREE.CanvasTexture(canvas), aspect: canvas.width / canvas.height };
}

/** Where a speaker is: the stand-ins have their feet's x and z and their height. */
interface Placed {
  readonly xM: number;
  readonly zM: number;
  readonly heightM: number;
}

/** The lines in the scene: one sprite per enemy, its texture redrawn when its line changes. */
export class EnemySpeech {
  readonly lines = new SpeechLines<object>();
  shown = true;
  private readonly sprites = new Map<object, { sprite: THREE.Sprite; text: string }>();

  constructor(
    private readonly scene: THREE.Scene,
    /** The enemies in the room (the list may change). */
    private readonly speakers: readonly Placed[],
  ) {}

  say(speaker: object, kind: CalloutKind, side?: 'left' | 'right'): void {
    this.lines.say(speaker, calloutText(kind, side));
  }

  /** Once per screen frame. */
  update(dtSec: number): void {
    this.lines.update(dtSec);
    for (const speaker of this.speakers) {
      const text = this.shown ? this.lines.textOf(speaker) : null;
      let entry = this.sprites.get(speaker);
      if (!text) {
        if (entry) entry.sprite.visible = false;
        continue;
      }
      if (!entry) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
        sprite.renderOrder = 1; // drawn after the world, over walls
        this.scene.add(sprite);
        entry = { sprite, text: '' };
        this.sprites.set(speaker, entry);
      }
      if (entry.text !== text) {
        const { texture, aspect } = lineTexture(text);
        entry.sprite.material.map?.dispose();
        entry.sprite.material.map = texture;
        entry.sprite.material.needsUpdate = true;
        entry.sprite.scale.set(lineHeightM * aspect, lineHeightM, 1);
        entry.text = text;
      }
      entry.sprite.visible = true;
      entry.sprite.position.set(speaker.xM, speaker.heightM + aboveHeadM, speaker.zM);
    }
  }
}
