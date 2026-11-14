import * as THREE from 'three';
import type { StandInEnemy } from '../enemies/standInEnemy';

const letters = 'ABCDEFGH';
const idleColour = 0xffffff;
const firingColour = 0xff9a2e;
const flankingColour = 0x4aa8ff;
const labelSizeM = 0.35;
const aboveHeadM = 0.35;
const texturePx = 64;

/** A square texture with one white letter on it. */
function letterTexture(letter: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = texturePx;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = `bold ${texturePx * 0.8}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 6;
    context.strokeStyle = '#000';
    context.strokeText(letter, texturePx / 2, texturePx / 2);
    context.fillStyle = '#fff';
    context.fillText(letter, texturePx / 2, texturePx / 2);
  }
  return new THREE.CanvasTexture(canvas);
}

// Dev-only overlay for 4.6 (architecture.md, "enemy state labels"): a letter floating over each stand-in (A, B, C, D, as
// in the readout), seen through walls, orange while it holds one of the squad's firing slots (so you can see that only
// two fire at once), blue while it is flanking (4.7). Hidden until the dev panel tick shows it.
export class EnemyLabels {
  private readonly sprites: THREE.Sprite[] = [];
  shown = false;

  constructor(
    private readonly scene: THREE.Scene,
    /** The stand-ins in the room (the list may change); the letter is the place in the list. */
    private readonly standIns: readonly StandInEnemy[],
    private readonly holdsSlot: (enemy: StandInEnemy) => boolean,
  ) {}

  /** Once per screen frame. */
  update(): void {
    while (this.sprites.length < this.standIns.length) {
      const letter = letters[this.sprites.length % letters.length];
      const material = new THREE.SpriteMaterial({ map: letterTexture(letter), depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(labelSizeM);
      sprite.renderOrder = 1; // drawn after the world, over walls
      this.scene.add(sprite);
      this.sprites.push(sprite);
    }
    this.sprites.forEach((sprite, i) => {
      const standIn = this.standIns[i];
      sprite.visible = this.shown && standIn !== undefined;
      if (!sprite.visible) return;
      sprite.position.set(standIn.xM, standIn.heightM + aboveHeadM, standIn.zM);
      const colour = standIn.state === 'flank' ? flankingColour : this.holdsSlot(standIn) ? firingColour : idleColour;
      sprite.material.color.setHex(colour);
    });
  }
}
