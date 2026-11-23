import * as THREE from 'three';
import { kitPrefix, maxTexturePx, propTriangleBudget } from '../level/modelFit';
import { disposeModel, isModelKept, loadModel, loadModelOnce, type LoadedModel } from '../level/models';

// The level editor's asset browser (5.2d part B, decision 288), dev server only. A floating window inside the page with a
// picture of every model in the kits folder: the pictures are drawn as their tiles scroll into view, one at a time, by a
// small second renderer, and kept for the session; a model loaded only for its picture is freed at once. Click a tile to
// see it turning with the asset rules beside it; "Put on selected boxes" (or a double-click) puts it on the selection.
// The window has a Models tab; 5.5c adds Materials.

/** A model file in the kits folder, as the dev server lists it (vite.config.ts): its size with every file it uses, and its widest texture. */
export interface KitFile {
  path: string;
  bytes: number;
  texturePx: number;
}

/** What the browser needs from the editor. */
export interface BrowserParts {
  /** The kits' model files; null while the dev server is still listing them. */
  files: () => KitFile[] | null;
  /** How many boxes are selected (Apply needs at least one). */
  selectedBoxes: () => number;
  /** Puts this model on the selected boxes (one undo step). */
  apply: (model: string) => void;
}

const thumbPx = 112;
const previewWidthPx = 300;
const previewHeightPx = 220;
const previewTurnRadPerSec = 0.6;
/** The camera's field of view and the direction it looks from (a little above and to the side, as a catalogue picture). */
const cameraFovDeg = 30;
const cameraFrom = new THREE.Vector3(1, 0.75, 1.4).normalize();
const backgroundColour = 0x2a2f35;
const style = {
  window:
    'position:fixed;right:12px;top:60px;width:560px;height:620px;min-width:360px;min-height:300px;resize:both;overflow:hidden;' +
    'display:none;flex-direction:column;background:#16191d;color:#ddd;font:11px sans-serif;border:1px solid #444;border-radius:4px;z-index:13;box-shadow:0 4px 18px #000a',
  header: 'display:flex;align-items:center;gap:8px;padding:6px 8px;background:#23272d;cursor:move;user-select:none',
  grid: 'flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;padding:6px;align-content:start',
  tile: 'cursor:pointer;background:#1f2328;border:1px solid #333;border-radius:3px;padding:3px;text-align:center;overflow:hidden',
  tileSelected: 'border-color:#ffc23d',
  picture: `width:${thumbPx}px;height:${thumbPx}px;display:block;margin:0 auto;background:#2a2f35;object-fit:contain`,
  name: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px',
  over: 'color:#ff6a4d;font-weight:bold',
};

/** A file size people can read: KB under a megabyte, MB with one decimal above. */
const sizeText = (bytes: number): string => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);

/** A small stage that frames one model: lights, a camera, and a holder the model is put in (scaled to about 1 m, centred). */
class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(cameraFovDeg, 1, 0.01, 100);
  readonly holder = new THREE.Group();

  constructor() {
    this.scene.background = new THREE.Color(backgroundColour);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444a50, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 5, 4);
    this.scene.add(sun, this.holder);
    // A unit-sized model's half diagonal is under 0.9 m; this far away it fills the picture.
    const distanceM = 0.9 / Math.sin((cameraFovDeg * Math.PI) / 360);
    this.camera.position.copy(cameraFrom).multiplyScalar(distanceM);
    this.camera.lookAt(0, 0, 0);
  }

  /** Shows this model (sharing its geometry and materials, nothing is copied), scaled to fit and centred. */
  show(model: LoadedModel): void {
    this.holder.clear();
    this.holder.rotation.y = 0;
    const size = model.bounds.getSize(new THREE.Vector3());
    const scale = 1 / Math.max(size.x, size.y, size.z, 1e-6);
    const centre = model.bounds.getCenter(new THREE.Vector3());
    const inner = new THREE.Group();
    inner.scale.setScalar(scale);
    inner.position.copy(centre).multiplyScalar(-scale);
    for (const part of model.parts) inner.add(new THREE.Mesh(part.geometry, part.material));
    this.holder.add(inner);
  }
}

export class AssetBrowser {
  private readonly window = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly search = document.createElement('input');
  private readonly pack = document.createElement('select');
  private readonly info = document.createElement('div');
  private readonly applyButton = document.createElement('button');
  // Pictures: drawn one at a time for the tiles in view, kept by model name for the session.
  private readonly thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private readonly thumbStage = new Stage();
  private readonly pictures = new Map<string, string>();
  private readonly facts = new Map<string, { triangles: number } | { error: string }>();
  private readonly inView = new Set<string>();
  private readonly waiting: string[] = [];
  private drawing = false;
  private readonly observer: IntersectionObserver;
  private readonly tiles = new Map<string, HTMLElement>();
  // The big preview.
  private readonly previewRenderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly previewStage = new Stage();
  private chosen: string | null = null;
  private lastFrameMs = 0;
  private frameRequest = 0;

  constructor(private readonly parts: BrowserParts) {
    this.window.style.cssText = style.window;
    const header = document.createElement('div');
    header.style.cssText = style.header;
    const title = document.createElement('b');
    title.textContent = 'Assets';
    const tab = document.createElement('span');
    tab.textContent = '[Models]'; // 5.5c adds Materials
    const close = document.createElement('button');
    close.textContent = 'Close (B)';
    close.style.marginLeft = 'auto';
    close.addEventListener('click', () => this.hide());
    header.append(title, tab, close);
    this.dragBy(header);

    const filters = document.createElement('div');
    filters.style.cssText = 'display:flex;gap:6px;padding:6px 8px 0';
    this.search.type = 'search';
    this.search.placeholder = 'search (several words)';
    this.search.style.flex = '1';
    this.search.addEventListener('input', () => this.fillGrid());
    this.pack.addEventListener('change', () => this.fillGrid());
    filters.append(this.search, this.pack);

    this.grid.style.cssText = style.grid;
    this.observer = new IntersectionObserver((entries) => this.seen(entries), { root: this.grid });

    const preview = document.createElement('div');
    preview.style.cssText = 'display:flex;gap:8px;padding:6px 8px;border-top:1px solid #333;align-items:flex-start';
    this.previewRenderer.setSize(previewWidthPx, previewHeightPx);
    this.previewStage.camera.aspect = previewWidthPx / previewHeightPx;
    this.previewStage.camera.updateProjectionMatrix();
    const side = document.createElement('div');
    side.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;word-break:break-all';
    this.info.textContent = 'Click a picture to see it here.';
    this.applyButton.textContent = 'Put on selected boxes (or double-click a picture)';
    this.applyButton.disabled = true;
    this.applyButton.addEventListener('click', () => this.applyChosen());
    side.append(this.info, this.applyButton);
    preview.append(this.previewRenderer.domElement, side);

    this.thumbRenderer.setSize(thumbPx, thumbPx);
    this.window.append(header, filters, this.grid, preview);
    document.body.appendChild(this.window);
  }

  get open(): boolean {
    return this.window.style.display !== 'none';
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.window.style.display = 'flex';
    this.refresh();
    this.lastFrameMs = performance.now();
    this.frameRequest = requestAnimationFrame((now) => this.turnPreview(now));
  }

  hide(): void {
    this.window.style.display = 'none';
    cancelAnimationFrame(this.frameRequest);
  }

  /** The kits list arrived or changed: the pack filter and the grid are rebuilt. */
  refresh(): void {
    const files = this.parts.files() ?? [];
    const packs = [...new Set(files.map((file) => file.path.split('/')[0]))].sort();
    const current = this.pack.value;
    this.pack.replaceChildren(new Option('all packs', ''), ...packs.map((pack) => new Option(pack, pack)));
    this.pack.value = packs.includes(current) ? current : '';
    this.fillGrid();
  }

  /** The tiles for the current search and pack. A tile's picture is drawn once it scrolls into view. */
  private fillGrid(): void {
    const files = this.parts.files();
    this.observer.disconnect();
    this.inView.clear();
    this.tiles.clear();
    this.grid.replaceChildren();
    if (files === null) {
      this.grid.textContent = 'listing the kits...';
      return;
    }
    const words = this.search.value.toLowerCase().split(/\s+/).filter((word) => word !== '');
    const matches = files.filter((file) => (this.pack.value === '' || file.path.startsWith(`${this.pack.value}/`)) && words.every((word) => file.path.toLowerCase().includes(word)));
    if (matches.length === 0) this.grid.textContent = files.length === 0 ? 'no model files in the kits folder (see vite.config.ts)' : 'no match';
    for (const file of matches) {
      const name = kitPrefix + file.path;
      const tile = document.createElement('div');
      tile.style.cssText = style.tile + (name === this.chosen ? `;${style.tileSelected}` : '');
      tile.title = file.path;
      tile.dataset.model = name;
      const picture = document.createElement('img');
      picture.style.cssText = style.picture;
      picture.alt = '';
      const url = this.pictures.get(name);
      if (url) picture.src = url;
      const label = document.createElement('div');
      label.style.cssText = style.name;
      label.textContent = file.path.split('/').pop()!.replace(/\.(glb|gltf|obj)$/i, '');
      tile.append(picture, label, this.badge(name, file));
      tile.addEventListener('click', () => void this.choose(name));
      tile.addEventListener('dblclick', () => {
        this.chosen = name;
        this.applyChosen();
      });
      this.tiles.set(name, tile);
      this.grid.append(tile);
      this.observer.observe(tile);
    }
  }

  /** The line under a picture: the size, and OVER where the model breaks an asset rule (known once its picture is drawn). */
  private badge(name: string, file: KitFile): HTMLElement {
    const line = document.createElement('div');
    const fact = this.facts.get(name);
    const overTriangles = fact && 'triangles' in fact && fact.triangles > propTriangleBudget;
    const overTexture = file.texturePx > maxTexturePx;
    line.textContent = sizeText(file.bytes);
    if (fact && 'error' in fact) line.append(' · no load');
    if (overTriangles || overTexture) {
      const over = document.createElement('span');
      over.style.cssText = style.over;
      over.textContent = ' OVER';
      over.title = [overTriangles ? `over ${propTriangleBudget} triangles` : '', overTexture ? `textures over ${maxTexturePx} px` : ''].filter(Boolean).join(', ');
      line.append(over);
    }
    return line;
  }

  /** Tiles scrolled into or out of view: those in view and still without a picture wait their turn. */
  private seen(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const name = (entry.target as HTMLElement).dataset.model!;
      if (entry.isIntersecting) {
        this.inView.add(name);
        if (!this.pictures.has(name) && !this.facts.has(name) && !this.waiting.includes(name)) this.waiting.push(name);
      } else this.inView.delete(name);
    }
    void this.drawNext();
  }

  /** Draws the pictures waiting, one at a time, skipping any tile scrolled away meanwhile. */
  private async drawNext(): Promise<void> {
    if (this.drawing) return;
    this.drawing = true;
    try {
      while (this.waiting.length > 0) {
        const name = this.waiting.shift()!;
        if (!this.inView.has(name) || this.pictures.has(name)) continue;
        await this.drawPicture(name);
      }
    } finally {
      this.drawing = false;
    }
  }

  private async drawPicture(name: string): Promise<void> {
    const kept = isModelKept(name);
    let model: LoadedModel;
    try {
      model = kept ? await loadModel(name) : await loadModelOnce(name);
    } catch (error) {
      this.facts.set(name, { error: error instanceof Error ? error.message : 'could not load' });
      this.updateTile(name);
      return;
    }
    this.thumbStage.show(model);
    this.thumbRenderer.render(this.thumbStage.scene, this.thumbStage.camera);
    this.pictures.set(name, this.thumbRenderer.domElement.toDataURL('image/png'));
    this.facts.set(name, { triangles: model.triangles });
    this.thumbStage.holder.clear();
    if (!kept) disposeModel(model); // loaded only for its picture
    this.updateTile(name);
  }

  /** A tile's picture and badge, once they are known. */
  private updateTile(name: string): void {
    const tile = this.tiles.get(name);
    const file = this.parts.files()?.find((kitFile) => kitPrefix + kitFile.path === name);
    if (!tile || !file) return;
    const url = this.pictures.get(name);
    if (url) (tile.querySelector('img') as HTMLImageElement).src = url;
    tile.lastElementChild!.replaceWith(this.badge(name, file));
  }

  /** A click on a tile: the model turns in the preview, with the asset rules beside it. */
  private async choose(name: string): Promise<void> {
    this.chosen = name;
    for (const [tileName, tile] of this.tiles) tile.style.cssText = style.tile + (tileName === name ? `;${style.tileSelected}` : '');
    const file = this.parts.files()?.find((kitFile) => kitPrefix + kitFile.path === name);
    this.info.textContent = `${file?.path ?? name}: loading...`;
    this.applyButton.disabled = true;
    try {
      const model = await loadModel(name); // kept: it is likely to be put on a box next
      if (this.chosen !== name) return;
      this.previewStage.show(model);
      const lines = [
        file?.path ?? name,
        `${model.triangles} triangles${model.triangles > propTriangleBudget ? ` (OVER the ${propTriangleBudget} budget)` : ''}`,
        file ? `${sizeText(file.bytes)} with its files` : '',
        file && file.texturePx > 0 ? `textures up to ${file.texturePx} px${file.texturePx > maxTexturePx ? ` (OVER ${maxTexturePx}: would need shrinking)` : ''}` : '',
      ];
      this.info.replaceChildren(...lines.filter(Boolean).map((text) => Object.assign(document.createElement('div'), { textContent: text })));
      this.applyButton.disabled = false;
    } catch (error) {
      if (this.chosen === name) this.info.textContent = `${file?.path ?? name}: could not load (${error instanceof Error ? error.message : 'unknown'})`;
    }
  }

  private applyChosen(): void {
    if (!this.chosen) return;
    if (this.parts.selectedBoxes() === 0) {
      this.info.textContent = 'Select one or more boxes in the level first (click them), then apply.';
      return;
    }
    this.parts.apply(this.chosen);
  }

  /** While open: the preview turns slowly. */
  private turnPreview(now: number): void {
    const dtSec = (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    this.previewStage.holder.rotation.y += previewTurnRadPerSec * dtSec;
    this.previewRenderer.render(this.previewStage.scene, this.previewStage.camera);
    if (this.open) this.frameRequest = requestAnimationFrame((next) => this.turnPreview(next));
  }

  /** The window is moved by dragging its title bar. */
  private dragBy(handle: HTMLElement): void {
    handle.addEventListener('mousedown', (down) => {
      if ((down.target as HTMLElement).tagName === 'BUTTON') return;
      const box = this.window.getBoundingClientRect();
      const offsetX = down.clientX - box.left;
      const offsetY = down.clientY - box.top;
      const move = (event: MouseEvent) => {
        this.window.style.left = `${Math.max(0, event.clientX - offsetX)}px`;
        this.window.style.top = `${Math.max(0, event.clientY - offsetY)}px`;
        this.window.style.right = 'auto';
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
}
