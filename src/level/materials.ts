import * as THREE from 'three';
import { materialDef, palette, type MaterialDef } from '../data/materials';

// Draws the lab's materials (5.5c Part 1, decision 290) on small canvases when the game starts: no texture files, a few KB
// of memory each. The list and the colours are in src/data/materials.ts. Each picture repeats every `tileM` metres,
// because box and floor faces carry their picture coordinates in metres (src/level/greybox.ts). Browser only.

/** A picture's long side in pixels: enough for seams and slots to read, small enough to cost nothing. */
const pictureLongSidePx = 256;
/** How strongly a glowing material (a screen) lights itself, so it shows in the dark lab. */
const glowStrength = 0.9;
/** Surface roughness and shine: the lab's paint and metal are matte, a little shinier for metal. */
const roughness = 0.85;
const metalness = { metal: 0.25, other: 0.05 };

const drawn = new Map<string, THREE.Material>();
const pictures = new Map<string, HTMLCanvasElement>();

/** The game's material for a name (made once, then shared by every box that uses it). Unknown names get the metal panel. */
export function texturedMaterial(name: string): THREE.Material {
  const known = drawn.get(name);
  if (known) return known;
  const def = materialDef(name) ?? materialDef('metal-panel')!;
  const texture = new THREE.CanvasTexture(picture(def));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / def.tileM[0], 1 / def.tileM[1]);
  texture.anisotropy = 4; // floors seen at a low angle stay sharp
  const isMetal = def.pattern === 'plates' || def.pattern === 'rack' || def.base === palette.metal;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness,
    metalness: isMetal ? metalness.metal : metalness.other,
    ...(def.glow ? { emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: glowStrength } : {}),
  });
  material.name = def.name;
  drawn.set(name, material);
  return material;
}

/** The material's picture as an image address, for the editor's Materials tab. */
export function materialPictureUrl(name: string): string {
  const def = materialDef(name);
  return def ? picture(def).toDataURL('image/png') : '';
}

/** One tile of the material, drawn once. Its shape follows the tile's (a server rack picture is tall). */
function picture(def: MaterialDef): HTMLCanvasElement {
  const known = pictures.get(def.name);
  if (known) return known;
  const [tileW, tileH] = def.tileM;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(tileW >= tileH ? pictureLongSidePx : (pictureLongSidePx * tileW) / tileH);
  canvas.height = Math.round(tileH >= tileW ? pictureLongSidePx : (pictureLongSidePx * tileH) / tileW);
  const g = canvas.getContext('2d')!;
  painters[def.pattern](g, canvas.width, canvas.height, def);
  pictures.set(def.name, canvas);
  return canvas;
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, def: MaterialDef) => void;

/** A frame line round the picture's edge: where one tile meets the next. */
function edge(g: CanvasRenderingContext2D, w: number, h: number, colour: string, widthPx: number): void {
  g.strokeStyle = colour;
  g.lineWidth = widthPx;
  g.strokeRect(widthPx / 2, widthPx / 2, w - widthPx, h - widthPx);
}

/** The same speckle every time (a fixed seed), so the picture never changes between loads. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, colour: string, count: number): void {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = colour;
  for (let i = 0; i < count; i++) g.fillRect(next() * w, next() * h, 1 + next() * 2, 1 + next() * 2);
}

const painters: Record<MaterialDef['pattern'], Painter> = {
  panels(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    edge(g, w, h, def.line, 3);
  },
  tiles(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, def.line, 60);
    edge(g, w, h, def.line, 5);
  },
  plates(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    edge(g, w, h, def.line, 4);
    g.fillStyle = def.line; // rivets in the corners
    for (const [x, y] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) g.fillRect(x * w - 3, y * h - 3, 6, 6);
  },
  plain(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, def.line, 400);
  },
  stripes(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = def.line;
    const band = w / 4; // two dark and two warning bands per tile, at 45 degrees so neighbouring tiles join up
    for (let x = -h; x < w; x += band * 2) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + band, h);
      g.lineTo(x + band + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
  },
  screen(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = def.line; // lines of readout
    for (let row = 0; row < 6; row++) g.fillRect(w * 0.1, h * (0.15 + row * 0.12), w * (0.3 + ((row * 37) % 50) / 100), h * 0.05);
    edge(g, w, h, palette.darkMetal, 8);
  },
  rack(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    const rows = 14; // server units, each with a slot and a status light
    for (let row = 0; row < rows; row++) {
      const y = h * (0.04 + (row * 0.92) / rows);
      g.fillStyle = def.line;
      g.fillRect(w * 0.1, y, w * 0.8, h * 0.045);
      g.fillStyle = row % 3 === 0 ? palette.accent : palette.light;
      g.fillRect(w * 0.82, y + h * 0.012, w * 0.04, h * 0.02);
    }
    edge(g, w, h, palette.metal, 6);
  },
  lockers(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    edge(g, w, h, def.line, 5); // one locker door per tile
    g.fillStyle = def.line;
    for (let vent = 0; vent < 5; vent++) g.fillRect(w * 0.3, h * (0.08 + vent * 0.025), w * 0.4, h * 0.01);
    g.fillRect(w * 0.78, h * 0.45, w * 0.06, h * 0.12); // handle
  },
  fridge(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    edge(g, w, h, def.line, 5);
    g.fillStyle = def.line;
    g.fillRect(0, h * 0.34, w, 4); // freezer door above, fridge below
    g.fillRect(w * 0.85, h * 0.1, w * 0.04, h * 0.18);
    g.fillRect(w * 0.85, h * 0.42, w * 0.04, h * 0.3);
    g.fillStyle = palette.accent; // a small temperature display
    g.fillRect(w * 0.12, h * 0.12, w * 0.2, h * 0.05);
  },
  hood(g, w, h, def) {
    g.fillStyle = def.base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = palette.accentDim; // the glass sash over the work surface
    g.fillRect(w * 0.08, h * 0.1, w * 0.84, h * 0.42);
    g.fillStyle = def.line;
    g.fillRect(w * 0.08, h * 0.3, w * 0.84, 4); // the sash's frame
    g.fillRect(0, h * 0.58, w, 5); // the work top
    g.fillRect(w * 0.5 - 2, h * 0.62, 4, h * 0.36); // two cupboard doors below
    edge(g, w, h, def.line, 5);
  },
};
