import * as THREE from 'three';
import GUI, { type Controller } from 'lil-gui';
import type { Input } from '../core/input';
import { mouseButtons } from '../config/input';
import { roles } from '../config/roles';
import { playerConfig } from '../config/player';
import { isClimbable, rampRises } from '../data/greyboxRoom';
import { boxGeometry, buildGreybox } from '../level/greybox';
import { LevelError, levelLayout, levelToJson, tidy, tidyDecimals, type LevelBox, type LevelData, type LevelSpot } from '../level/levelData';
import {
  addBox,
  addMarker,
  boxPresets,
  duplicateMany,
  EditHistory,
  listGroups,
  locate,
  modelCount,
  noModelGroup,
  noModelGroupName,
  markerHeightM,
  markerWidthM,
  moveMany,
  pickAt,
  picked,
  removeMany,
  setField,
  setFieldMany,
  snapTo,
  turnMany,
  type BoxPreset,
  type Pick,
} from '../level/levelEdit';
import { applyHandleDrag, closestOnAxis, layoutGizmo, minBoxSizeM, pickHandle, ringAngle, type GizmoHandle } from '../level/gizmo';
import { boxSizeFittedToModel, kitCopyUrl, kitListUrl, kitPrefix, maxTexturePx, modelMatrices, propTriangleBudget } from '../level/modelFit';
import { drawsModel, loadModel, type LoadedModel } from '../level/models';
import { normalYawDeg } from '../level/boxShape';
import { levelNameHeader, levelSaveUrl } from '../level/levelSave';
import { Navigation } from '../level/navigation';
import { describeReach, newSince, reachProblems, type ReachProblem } from '../level/reach';
import { AssetBrowser, type KitFile } from './assetBrowser';
import { GizmoView } from './gizmoView';

// The in-game level editor (milestone 5.2, decision 273; 5.2b, decision 281; 5.2c, decision 285), dev server only. F2 turns
// it on, with the free camera and a free cursor (5.2d): the game keeps running without the mouse captured, holding the
// right button looks around (W A S D fly), and the panel is used like any page. Point at a piece or marker and click to
// select it (Shift-click adds or takes away); or pick from the list at the top of the panel (search it by name, id or
// group; click a folder's "select all"). Arrows and the rotate ring (5.5a; M switches them to size handles) are dragged
// with the left button under the cursor. The keys move the selection too (arrows, Shift: 1 m; Page Up and Page Down raise
// and lower it), R turns each piece 90 degrees, N copies, Delete removes, U undoes. Its panel sits bottom left. A moment after each change it rebuilds the walkable floor from its copy and reports
// what the enemies or Rook can no longer walk to (src/level/reach.ts). Save sends the level to the dev server, which writes
// src/data/levels/<name>.json; the page then reloads with it, and only then do collision, routes, cover and enemies use
// the new layout. Until then it draws its own copy of the boxes.

const stepM = 0.25;
const bigStepM = 1;
/** A drag rounds to this, or to `stepM` with Shift held. */
const dragStepM = 0.05;
/** The rotate ring turns in steps of this many degrees, or the bigger step with Shift held (5.5a). */
const turnStepDeg = 5;
const turnBigStepDeg = 15;
/** New pieces go this far in front of the camera, on the floor. */
const placeAheadM = 4;
/** The reach check runs this long after the last change (so a run of key presses builds once). */
const previewAfterSec = 0.3;
const colours = { wall: 0x4a4f55, prop: 0x8a9097, glass: 0x7fc8e8, hidden: 0xb79cff, start: 0x33dd66, dummy: 0xe8e8e8, selected: 0xffc23d, outline: 0xffffff } as const;
const roleColours = { trooper: 0x6b7f3a, flanker: 0x9fb4c8, heavy: 0x222222, leader: 0x8a2a2a } as const;
const previewColours = { mesh: 0x3fd0ff, problem: 0xff2a2a } as const;
const keyHelp =
  'click pick (Shift adds) · hold right button to look, W A S D fly · drag an arrow or the ring with the left button (ring: 5 deg, Shift 15) · M arrows or size handles · arrows move · PgUp/PgDn height · R turn · N copy · Del delete · U undo · F2 off';
/** The list's rows and the folders that are open, in the panel. */
const listStyle = 'background:#1a1a1a;color:#ddd;font:11px sans-serif;padding:4px;margin-bottom:4px;border-radius:2px';
const selectedRowStyle = 'background:#5a4a14';

interface Parts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The level as loaded, and the meshes the game draws its boxes with (hidden while the copy here is shown). */
  level: LevelData;
  boxMeshes: readonly THREE.Mesh[];
  /** Turns the free camera on or off. */
  setFreeCamera: (on: boolean) => void;
  /** Tells the game the editor is on, so it runs with the cursor free (5.2d). */
  setEditing: (on: boolean) => void;
}

/** The walkable floor and the problems of one layout, for the reach preview. */
interface Reach {
  problems: ReachProblem[];
  enemyTriangles: [number[], number[]];
}

export class EditMode {
  active = false;
  private data: LevelData;
  private readonly savedJson: string;
  /** What is selected, by id; the last one is the main one (its fields are shown). */
  private selection: Pick[] = [];
  private readonly history = new EditHistory();
  private readonly group = new THREE.Group();
  /** The drawn copy's meshes by id, so a drag can redraw just the ones it changes. */
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly panelBox = document.createElement('div');
  private readonly panel: GUI;
  private readonly selectedFolder: GUI;
  private fieldControllers: Controller[] = [];
  private message = '';
  /** The direction from the camera through the cursor (5.2d: the cursor picks, not the middle of the screen). */
  private readonly ray = new THREE.Vector3();
  // The arrows and size handles (5.2c).
  private readonly gizmo = new GizmoView();
  private gizmoMode: 'move' | 'size' = 'move';
  private hover: string | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly cursor = new THREE.Vector2();
  /**
   * While a handle is dragged: the handle as it was at the start (the line or ring the drag follows stays put) and the level
   * before. For the ring, `startParam` is the last angle under the cursor and `turnedRad` how far it has gone in all (so it
   * can pass half a turn without jumping back).
   */
  private handleDrag: { handle: GizmoHandle; before: LevelData; startParam: number; turnedRad: number } | null = null;
  // The list (5.2c).
  private readonly listBody = document.createElement('div');
  private searchText = '';
  private readonly openFolders = new Set<string>();
  // The reach preview.
  private readonly previewGroup = new THREE.Group();
  private baseline: ReachProblem[] | null = null;
  private reachLines: string[] = [];
  private previewLeftSec = -1;
  private previewRun = 0;
  // Models on boxes (5.5b): the kits' files (null until the dev server has listed them), the models loaded so far, and why some could not load.
  private kitFiles: KitFile[] | null = null;
  private readonly models = new Map<string, LoadedModel>();
  private readonly modelErrors = new Map<string, string>();
  private readonly modelsLoading = new Set<string>();
  /** The asset browser window (5.2d part B): pictures of the kits' models, put on the selected boxes. */
  private readonly browser = new AssetBrowser({
    files: () => this.kitFiles,
    selectedBoxes: () => this.selectedBoxIds().length,
    apply: (model) => this.change(setFieldMany(this.data, this.selectedBoxIds(), 'model', model)),
  });

  constructor(private readonly parts: Parts) {
    this.data = parts.level;
    this.savedJson = JSON.stringify(parts.level);
    this.group.visible = false;
    parts.scene.add(this.group);
    this.previewGroup.visible = false;
    parts.scene.add(this.previewGroup);
    parts.scene.add(this.gizmo.group);

    // Its own panel, bottom left, shown while the editor is on (5.2b): the list of pieces on top, the editor's buttons below.
    this.panelBox.style.cssText = 'position:fixed;left:8px;bottom:8px;max-height:60vh;overflow-y:auto;z-index:12;display:none;width:300px';
    document.body.appendChild(this.panelBox);
    this.panelBox.appendChild(this.buildList());
    this.panel = new GUI({ container: this.panelBox, title: `Level editor: ${parts.level.name}`, width: 300 });
    this.panel.add({ save: () => void this.save() }, 'save').name('Save to the level file');
    this.panel.add({ undo: () => this.undo() }, 'undo').name('Undo (U)');
    const adds = this.panel.addFolder('Add (where you look)');
    adds.close();
    for (const preset of Object.keys(boxPresets) as BoxPreset[]) adds.add({ add: () => this.addPiece(preset) }, 'add').name(`Add ${preset}`);
    adds.add({ add: () => this.addSpot('dummies') }, 'add').name('Add dummy');
    adds.add({ add: () => this.addSpot('spawns') }, 'add').name('Add enemy spawn');
    this.panel.add({ copy: () => this.duplicatePick() }, 'copy').name('Duplicate (N)');
    this.panel.add({ del: () => this.removePick() }, 'del').name('Delete (Del)');
    this.panel.add({ mode: () => this.switchGizmo() }, 'mode').name('Arrows or size handles (M)');
    this.panel.add(this.previewGroup, 'visible').name('Show the reach preview');
    this.panel.add({ open: () => this.browser.toggle() }, 'open').name('Asset browser: models (B)');
    this.panel.add({ copy: () => void this.copyKitModels() }, 'copy').name('Copy kit models into the game (and save)');
    this.selectedFolder = this.panel.addFolder('Selected');
    this.refreshList();
  }

  toggle(on: boolean): void {
    this.active = on;
    this.parts.setFreeCamera(on);
    this.parts.setEditing(on);
    this.panelBox.style.display = on ? 'block' : 'none';
    if (!on) {
      this.endHandleDrag();
      this.gizmo.hide();
      this.browser.hide();
    }
    if (on && this.baseline === null) void this.measureBaseline();
    if (on && this.kitFiles === null) void this.loadKitList();
    this.redraw();
  }

  /** True while the copy here differs from the level as loaded (and saved). */
  get dirty(): boolean {
    return JSON.stringify(this.data) !== this.savedJson;
  }

  /** The main selected item (the last one picked), or null. */
  private get pick(): Pick | null {
    return this.selection[this.selection.length - 1] ?? null;
  }

  /** Once per frame while it is on: picking, dragging, the keys, the arrows, and the reach preview's timer. */
  update(input: Input, dtSec = 0): void {
    if (this.previewLeftSec >= 0 && !this.handleDrag) {
      this.previewLeftSec -= dtSec;
      if (this.previewLeftSec < 0) void this.preview();
    }
    if (!this.active) return;
    const { camera } = this.parts;
    const shift = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
    const looking = input.isButtonDown(mouseButtons.right); // the right button turns the view (debug/index.ts); nothing is picked meanwhile
    camera.updateMatrixWorld();
    this.cursor.set(input.pointer.x, input.pointer.y);
    this.raycaster.setFromCamera(this.cursor, camera);
    this.ray.copy(this.raycaster.ray.direction);
    // The arrows or handles: the one under the cursor lights up; a left press on it starts a drag, anywhere else it picks.
    const handles = layoutGizmo(this.data, this.selection, this.gizmoMode, camera.position);
    if (this.handleDrag) {
      if (input.isButtonDown(mouseButtons.left)) this.handleDragStep(shift);
      else this.endHandleDrag();
    } else {
      this.hover = looking ? null : (pickHandle(handles, camera.position, this.ray)?.key ?? null);
      if (input.consumeButtonPress(mouseButtons.left) && !looking) {
        const handle = handles.find((candidate) => candidate.key === this.hover);
        if (handle) this.startHandleDrag(handle);
        else this.clickPick(shift);
      }
    }
    this.gizmo.update(this.handleDrag ? layoutGizmo(this.data, this.selection, this.gizmoMode, camera.position) : handles, this.hover, this.handleDrag?.handle.key ?? null);
    if (this.handleDrag) return; // everything else waits until the drag is over
    if (input.consumePress('KeyU')) this.undo();
    if (input.consumePress('KeyM')) this.switchGizmo();
    if (input.consumePress('KeyB')) this.browser.toggle();
    if (this.selection.length === 0) return;
    const step = shift ? bigStepM : stepM;
    // Arrows move along the floor axis nearest to where you look, so "up" is always away from you.
    const alongX = Math.abs(this.ray.x) > Math.abs(this.ray.z);
    const fwd = { x: alongX ? Math.sign(this.ray.x) : 0, z: alongX ? 0 : Math.sign(this.ray.z) };
    const right = { x: -fwd.z, z: fwd.x };
    const moves: [string, number, number, number][] = [
      ['ArrowUp', fwd.x, 0, fwd.z],
      ['ArrowDown', -fwd.x, 0, -fwd.z],
      ['ArrowRight', right.x, 0, right.z],
      ['ArrowLeft', -right.x, 0, -right.z],
      ['PageUp', 0, 1, 0],
      ['PageDown', 0, -1, 0],
    ];
    for (const [key, dx, dy, dz] of moves) {
      if (input.consumePress(key)) this.change(moveMany(this.data, this.selection, dx * step, dy * step, dz * step));
    }
    if (input.consumePress('KeyR')) this.change(turnMany(this.data, this.selection));
    if (input.consumePress('KeyN')) this.duplicatePick();
    if (input.consumePress('Delete')) this.removePick();
  }

  /** The editor's lines for the readout box (shown in place of the usual readouts while it is on). */
  lines(): string[] {
    const main = this.pick ? picked(this.data, this.pick) : undefined;
    const what =
      !this.pick || !main
        ? 'nothing (aim and click, or use the list)'
        : this.selection.length > 1
          ? `${this.selection.length} pieces, the main one: ${describe(this.data, this.pick, main)}`
          : describe(this.data, this.pick, main);
    const counted = modelCount(this.data);
    const sizeNeedsOne =this.gizmoMode === 'size' && this.selection.length > 0 && layoutGizmo(this.data, this.selection, 'size', this.parts.camera.position).length === 0;
    return [
      `EDITOR    ${this.data.name}: ${this.data.boxes.length} boxes, ${this.data.spawns.length} spawns, ${this.data.dummies.length} dummies${this.dirty ? ', UNSAVED changes (collision and enemies still use the saved layout)' : ', saved'}`,
      `selected  ${what}${this.handleDrag ? ' (dragging)' : ''}`,
      `handles   ${this.gizmoMode === 'move' ? 'move arrows and the turn ring' : 'size handles'} (M switches)${sizeNeedsOne ? ': size handles need exactly one box selected' : ''}`,
      `models    ${counted.withModel} of ${counted.total} pieces of equipment have a model; the rest are in the list's "${noModelGroupName}" folder`,
      `keys      ${keyHelp}`,
      ...(main && this.pick && locate(this.data, this.pick)?.list === 'boxes' && (main as LevelBox).model ? [`model     ${this.modelLine(main as LevelBox)}`] : []),
      ...this.reachLines.map((line, i) => `${i === 0 ? 'reach     ' : '          '}${line}`),
      ...(this.message ? [`note      ${this.message}`] : []),
    ];
  }

  // ---- The arrows and size handles (5.2c).

  private switchGizmo(): void {
    this.gizmoMode = this.gizmoMode === 'move' ? 'size' : 'move';
    this.message = '';
  }

  /** A left press on an arrow, handle or the ring: the drag follows that line (or goes round the ring) under the cursor. */
  private startHandleDrag(handle: GizmoHandle): void {
    const startParam = handle.kind === 'turn' ? (ringAngle(handle, this.parts.camera.position, this.ray)?.angleRad ?? null) : closestOnAxis(this.parts.camera.position, this.ray, handle.origin, handle.dir);
    if (startParam === null) return;
    this.handleDrag = { handle, before: this.data, startParam, turnedRad: 0 };
  }

  /** One frame of a handle drag: the piece follows the nearest point of the handle's line (or ring) to the ray through the cursor (set in `update`). */
  private handleDragStep(shift: boolean): void {
    const drag = this.handleDrag;
    if (!drag) return;
    if (drag.handle.kind === 'turn') {
      const hit = ringAngle(drag.handle, this.raycaster.ray.origin, this.raycaster.ray.direction);
      if (!hit) return;
      const step = hit.angleRad - drag.startParam;
      drag.turnedRad += Math.atan2(Math.sin(step), Math.cos(step)); // the short way round since the last frame
      drag.startParam = hit.angleRad;
      const deg = snapTo((drag.turnedRad * 180) / Math.PI, shift ? turnBigStepDeg : turnStepDeg);
      this.showDragged(applyHandleDrag(drag.before, this.selection, drag.handle, deg));
      return;
    }
    const param = closestOnAxis(this.raycaster.ray.origin, this.raycaster.ray.direction, drag.handle.origin, drag.handle.dir);
    if (param === null) return;
    const along = snapTo(param - drag.startParam, shift ? stepM : dragStepM);
    this.showDragged(applyHandleDrag(drag.before, this.selection, drag.handle, along));
  }

  /** The drag is over: it becomes one undo step, and the reach preview runs. */
  private endHandleDrag(): void {
    if (!this.handleDrag) return;
    const { before } = this.handleDrag;
    this.handleDrag = null;
    if (this.data !== before) {
      this.history.push(before);
      this.afterChange();
    }
  }

  /** While dragging: the new level, with only the selected pieces redrawn (the rest cannot have changed). */
  private showDragged(next: LevelData): void {
    if (next === this.data) return;
    this.data = next;
    for (const id of this.selection) this.rebuildMesh(id);
  }

  // ---- Selecting.

  /** A left click that is not on an arrow: picks what the dot aims at (Shift adds or takes away), or clears the selection. */
  private clickPick(shift: boolean): void {
    const hit = pickAt(this.data, this.parts.camera.position, this.ray);
    if (!hit) {
      if (!shift) this.setSelection([]);
      return;
    }
    this.setSelection(shift ? toggled(this.selection, hit) : [hit]);
  }

  private setSelection(ids: Pick[]): void {
    this.selection = ids;
    this.message = '';
    this.redraw();
    this.showFields();
    this.refreshList();
  }

  /** A change: remembered for undo, then drawn. `selection` replaces the selection if given. */
  private change(next: LevelData, selection?: Pick[]): void {
    if (next === this.data) return;
    this.history.push(this.data);
    this.data = next;
    if (selection !== undefined) this.selection = selection;
    this.afterChange();
  }

  private afterChange(): void {
    this.message = '';
    this.redraw();
    this.showFields();
    this.refreshList();
    this.previewLeftSec = previewAfterSec;
  }

  private undo(): void {
    const before = this.history.undo();
    if (!before) {
      this.message = 'nothing to undo';
      return;
    }
    this.data = before;
    this.selection = this.selection.filter((id) => picked(this.data, id)); // an undone copy is gone
    this.afterChange();
  }

  /** Where a new piece goes: on the floor, `placeAheadM` in front of the camera. */
  private placeAt(): { x: number; z: number } {
    const { camera } = this.parts;
    camera.getWorldDirection(this.ray);
    const flat = Math.hypot(this.ray.x, this.ray.z) || 1;
    return { x: snapTo(camera.position.x + (this.ray.x / flat) * placeAheadM, stepM), z: snapTo(camera.position.z + (this.ray.z / flat) * placeAheadM, stepM) };
  }

  private addPiece(preset: BoxPreset): void {
    const at = this.placeAt();
    const added = addBox(this.data, preset, at.x, at.z);
    this.change(added.level, [added.pick]);
  }

  private addSpot(list: 'dummies' | 'spawns'): void {
    const at = this.placeAt();
    const added = addMarker(this.data, list, at.x, at.z);
    this.change(added.level, [added.pick]);
  }

  private duplicatePick(): void {
    if (this.selection.length === 0) return;
    const copies = duplicateMany(this.data, this.selection);
    if (!copies) {
      this.message = "Rook's start cannot be copied";
      return;
    }
    this.change(copies.level, copies.picks);
  }

  private removePick(): void {
    if (this.selection.length === 0) return;
    const next = removeMany(this.data, this.selection);
    if (!next) {
      this.message = "Rook's start cannot be deleted";
      return;
    }
    this.change(next, []);
  }

  private async save(): Promise<void> {
    let text: string;
    try {
      text = levelToJson(this.data);
    } catch (error) {
      this.message = error instanceof LevelError ? `not saved: ${error.problems.join('; ')}` : `not saved: ${String(error)}`;
      return;
    }
    try {
      const response = await fetch(levelSaveUrl, { method: 'POST', headers: { [levelNameHeader]: this.data.name, 'content-type': 'application/json' }, body: text });
      this.message = response.ok ? 'saved: the page reloads with the new layout' : `not saved: ${await response.text()}`;
    } catch (error) {
      this.message = `not saved: the dev server did not answer (${String(error)})`;
    }
  }

  /**
   * "Copy kit models into the game" (5.5b Part 2): the dev server copies the kit files from credited packs into
   * src/assets/models/, renames the boxes' models and saves the level (src/level/kitCopy.ts); the page then reloads.
   */
  private async copyKitModels(): Promise<void> {
    try {
      const response = await fetch(kitCopyUrl, { method: 'POST', headers: { [levelNameHeader]: this.data.name, 'content-type': 'application/json' }, body: JSON.stringify(this.data) });
      if (!response.ok) {
        this.message = `not copied: ${await response.text()}`;
        return;
      }
      const result = (await response.json()) as { copied: string[]; refused: { model: string; why: string }[] };
      const refused = result.refused.map((item) => `${item.model} (${item.why})`).join('; ');
      this.message = `copied ${result.copied.length} model file(s) into the game and saved: the page reloads${refused ? `. Left as kit files: ${refused}` : ''}`;
    } catch (error) {
      this.message = `not copied: the dev server did not answer (${String(error)})`;
    }
  }

  // ---- The list (5.2c).

  /** The search box and the folders of pieces, above the panel. Filled by `refreshList`. */
  private buildList(): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = listStyle;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'search pieces (name, id or group)';
    search.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:4px';
    search.addEventListener('input', () => {
      this.searchText = search.value;
      this.refreshList();
    });
    this.listBody.style.cssText = 'max-height:220px;overflow-y:auto';
    box.append(search, this.listBody);
    return box;
  }

  /** Rebuilds the folders for the current search and selection. A folder stays open or closed as the user left it. */
  private refreshList(): void {
    this.listBody.replaceChildren();
    const searching = this.searchText.trim() !== '';
    const noModel = noModelGroup(this.data, this.searchText); // the equipment still grey (5.5b), first so it is easy to work through
    for (const folder of [...(noModel ? [noModel] : []), ...listGroups(this.data, this.searchText)]) {
      const details = document.createElement('details');
      details.open = searching || this.openFolders.has(folder.name);
      details.addEventListener('toggle', () => {
        if (searching) return; // a search opens every folder; that is not the user's choice
        if (details.open) this.openFolders.add(folder.name);
        else this.openFolders.delete(folder.name);
      });
      const summary = document.createElement('summary');
      summary.append(`${folder.name} (${folder.entries.length}) `);
      const all = document.createElement('button');
      all.textContent = 'select all';
      all.style.cssText = 'font-size:10px;margin-left:4px';
      all.addEventListener('click', (event) => {
        event.preventDefault(); // not a fold or unfold
        const ids = folder.entries.map((entry) => entry.id);
        this.setSelection(event.shiftKey ? [...this.selection.filter((id) => !ids.includes(id)), ...ids] : ids);
      });
      summary.append(all);
      details.append(summary);
      for (const entry of folder.entries) {
        const row = document.createElement('div');
        row.textContent = `${entry.label} [${entry.id}]`;
        row.style.cssText = `cursor:pointer;padding:1px 6px;${this.selection.includes(entry.id) ? selectedRowStyle : ''}`;
        row.addEventListener('click', (event) => this.setSelection(event.shiftKey ? toggled(this.selection, entry.id) : [entry.id]));
        details.append(row);
      }
      this.listBody.append(details);
    }
  }

  // ---- Models on boxes (5.5b).

  /** The selected boxes (markers in the selection are left out). */
  private selectedBoxIds(): Pick[] {
    return this.selection.filter((id) => locate(this.data, id)?.list === 'boxes');
  }

  /** Asks the dev server for the kits' model files (once, when the editor first opens); the asset browser shows them. */
  private async loadKitList(): Promise<void> {
    try {
      const response = await fetch(kitListUrl);
      this.kitFiles = response.ok ? ((await response.json()) as KitFile[]) : [];
    } catch {
      this.kitFiles = [];
    }
    this.browser.refresh();
  }

  /** Takes the model off every selected box: they are grey boxes again. */
  private clearModels(): void {
    const ids = this.selectedBoxIds();
    this.change(setFieldMany(setFieldMany(this.data, ids, 'model', undefined), ids, 'modelYawDeg', undefined));
  }

  /** Turns the model a quarter turn inside each selected box (the box itself does not move). */
  private turnModels(): void {
    let next = this.data;
    for (const id of this.selectedBoxIds()) {
      const box = picked(next, id) as LevelBox;
      if (box.model) next = setField(next, id, 'modelYawDeg', ((box.modelYawDeg ?? 0) + 90) % 360 || undefined);
    }
    this.change(next);
  }

  /** "Fit box to model": each selected box with a loaded model shrinks to the model's footprint (its collision and cover change). */
  private fitBoxesToModels(): void {
    let next = this.data;
    let waiting = 0;
    for (const id of this.selectedBoxIds()) {
      const box = picked(next, id) as LevelBox;
      const model = box.model ? this.models.get(box.model) : undefined;
      if (!model) {
        if (box.model) waiting++;
        continue;
      }
      const size = boxSizeFittedToModel(box, model.bounds, box.modelYawDeg ?? 0, minBoxSizeM, box.modelFit);
      next = setField(setField(setField(next, id, 'widthM', size.widthM), id, 'depthM', size.depthM), id, 'heightM', size.heightM);
    }
    this.change(next);
    if (waiting > 0) this.message = `${waiting} box${waiting === 1 ? "'s model has" : "es' models have"} not loaded, so ${waiting === 1 ? 'it was' : 'they were'} left as ${waiting === 1 ? 'it was' : 'they were'}`;
  }

  /** Starts loading a model the editor wants to draw; once it is in, the boxes that use it are redrawn with it. */
  private requestModel(name: string): void {
    if (this.models.has(name) || this.modelErrors.has(name) || this.modelsLoading.has(name)) return;
    this.modelsLoading.add(name);
    loadModel(name)
      .then(
        (model) => void this.models.set(name, model),
        (error: unknown) => void this.modelErrors.set(name, error instanceof Error ? error.message : 'the file could not be read'),
      )
      .finally(() => {
        this.modelsLoading.delete(name);
        if (!this.group.visible) return;
        for (const box of this.data.boxes) if (box.model === name) this.rebuildMesh(box.id);
      });
  }

  /** The readout's line about the main box's model: its triangles and size against the asset rules, or why it is grey. */
  private modelLine(box: LevelBox): string {
    const name = box.model!;
    const model = this.models.get(name);
    const error = this.modelErrors.get(name);
    const file = this.kitFiles?.find((kitFile) => kitPrefix + kitFile.path === name);
    const parts = [`${name}${box.modelYawDeg ? `, turned ${box.modelYawDeg} deg in its box` : ''}`];
    if (error) parts.push(`could not load (${error}), drawn grey`);
    else if (!model) parts.push('loading...');
    else parts.push(`${model.triangles} triangles${model.triangles > propTriangleBudget ? ` (OVER the ${propTriangleBudget} budget)` : ''}`);
    if (file) parts.push(`${(file.bytes / 1e6).toFixed(2)} MB with its files${file.texturePx > 0 ? `, textures up to ${file.texturePx} px${file.texturePx > maxTexturePx ? ` (OVER ${maxTexturePx}: would need shrinking)` : ''}` : ''}`);
    return parts.join(', ');
  }

  /** A box as the editor draws it: its model with the box's outline (the real collision), or the grey box while there is no model. */
  private boxView(box: LevelBox, selected: boolean): THREE.Object3D {
    const model = drawsModel(box) ? this.models.get(box.model!) : undefined;
    if (!model) {
      if (drawsModel(box)) this.requestModel(box.model!);
      return boxMesh(box, selected);
    }
    const holder = new THREE.Group();
    for (const matrix of modelMatrices(box, model.bounds, box.modelYawDeg ?? 0, box.modelFit)) {
      for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
        mesh.userData.shared = true; // the loaded model's geometry and materials are kept for the next redraw
        holder.add(mesh);
      }
    }
    holder.add(new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry(box)), new THREE.LineBasicMaterial({ color: selected ? colours.selected : colours.outline })));
    return holder;
  }

  // ---- The reach preview (5.2b).

  /** Builds a layout's walkable floor for the enemies and for Rook on foot, and what cannot be reached in it. */
  private async measure(level: LevelData): Promise<Reach> {
    const built = buildGreybox(level.boxes, levelLayout(level));
    const enemies = await Navigation.create(built.navigationGeometry);
    const rook = await Navigation.create(built.navigationGeometry, { agentRadiusM: playerConfig.capsuleRadiusM, agentHeightM: playerConfig.crouchHeightM });
    try {
      return { problems: reachProblems(level, enemies, rook), enemyTriangles: enemies.triangles() };
    } finally {
      enemies.dispose();
      rook.dispose();
      built.navigationGeometry.dispose();
      built.group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    }
  }

  /** What was already out of reach in the layout as loaded, so the report names only what the edits broke. */
  private async measureBaseline(): Promise<void> {
    this.baseline = (await this.measure(this.parts.level)).problems;
  }

  private async preview(): Promise<void> {
    const run = ++this.previewRun;
    const level = this.data;
    if (this.baseline === null) await this.measureBaseline();
    const startMs = performance.now();
    const reach = await this.measure(level);
    if (run !== this.previewRun) return; // a newer change started its own check
    const fresh = newSince(reach.problems, this.baseline ?? []);
    this.reachLines = [...describeReach(level, reach.problems, fresh), `checked in ${Math.round(performance.now() - startMs)} ms`];
    this.drawPreview(reach.enemyTriangles, fresh);
  }

  /** The enemies' walkable floor (see-through) and a red post on each new problem. */
  private drawPreview([positions, indices]: [number[], number[]], fresh: readonly ReachProblem[]): void {
    for (const child of [...this.previewGroup.children]) {
      this.previewGroup.remove(child);
      disposeMesh(child);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const floor = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: previewColours.mesh, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    floor.position.y = 0.03; // above the floor, so it does not flicker
    this.previewGroup.add(floor);
    const material = new THREE.MeshBasicMaterial({ color: previewColours.problem });
    for (const problem of fresh) {
      const tallM = problem.kind === 'spawn-no-route' ? 2.5 : problem.kind.endsWith('pocket') ? 0.1 : 1.2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(problem.kind.endsWith('pocket') ? 0.8 : 0.15, tallM, problem.kind.endsWith('pocket') ? 0.8 : 0.15), material);
      post.position.set(problem.x, problem.y + tallM / 2 + 0.03, problem.z);
      this.previewGroup.add(post);
    }
    this.previewGroup.visible = true;
  }

  // ---- Drawing.

  /** The mesh for one item as the editor draws it (selected ones glow), or null if there is none with this id. */
  private buildMesh(id: Pick): THREE.Object3D | null {
    const item = picked(this.data, id);
    const where = locate(this.data, id);
    if (!item || !where) return null;
    const selected = this.selection.includes(id);
    if (where.list === 'boxes') return this.boxView(item as LevelBox, selected);
    const colour = where.list === 'start' ? colours.start : where.list === 'dummies' ? colours.dummy : roleColours[(item as LevelSpot & { role: keyof typeof roleColours }).role];
    return markerMesh(item as LevelSpot, colour, selected);
  }

  /** Replaces one item's mesh with a fresh one (while a drag changes it). */
  private rebuildMesh(id: Pick): void {
    const old = this.meshes.get(id);
    if (old) {
      this.group.remove(old);
      disposeMesh(old);
      this.meshes.delete(id);
    }
    const fresh = this.buildMesh(id);
    if (!fresh) return;
    this.meshes.set(id, fresh);
    this.group.add(fresh);
  }

  /** Draws the copy of the level (boxes and markers) once it differs from the loaded one, or while editing. */
  private redraw(): void {
    const show = this.active || this.dirty;
    for (const mesh of this.parts.boxMeshes) mesh.visible = !show;
    this.group.visible = show;
    if (!show) this.previewGroup.visible = false;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeMesh(child);
    }
    this.meshes.clear();
    if (!show) return;
    const ids = [...this.data.boxes.map((box) => box.id), this.data.start.id, ...this.data.dummies.map((spot) => spot.id), ...this.data.spawns.map((spot) => spot.id)];
    for (const id of ids) this.rebuildMesh(id);
  }

  /** The panel's "Selected" folder: the main item's fields, typed into to change them (every selected box takes a shared field). */
  private showFields(): void {
    for (const controller of this.fieldControllers) controller.destroy();
    this.fieldControllers = [];
    const pick = this.pick;
    const item = pick ? picked(this.data, pick) : undefined;
    const where = pick ? locate(this.data, pick) : undefined;
    const many = this.selection.length > 1;
    this.selectedFolder.title(many ? `Selected: ${this.selection.length} pieces (these fields change all of them)` : 'Selected');
    if (!pick || !item || !where) return;
    const folder = this.selectedFolder;
    const ids = this.selection;
    // Numbers are shown and stored rounded as the file rounds them (5.2d): millimetres, tenths of a degree.
    const set = (field: string, value: unknown) => this.change(setFieldMany(this.data, ids, field, tidy(field, value)));
    const values: Record<string, unknown> = Object.fromEntries(Object.entries(item).map(([key, value]) => [key, tidy(key, value)]));
    const numberField = (field: string, step: number) => folder.add(values, field).step(step).decimals(tidyDecimals(field));
    const number = (field: string, step = 0.05) => this.fieldControllers.push(numberField(field, step).onFinishChange((v: number) => set(field, v)));
    const allBoxes = ids.every((id) => locate(this.data, id)?.list === 'boxes');
    if (where.list === 'boxes' && allBoxes) {
      const box = item as LevelBox;
      values.yM = tidy('yM', box.yM ?? 0);
      values.climbable = isClimbable(box);
      values.surface = box.surface ?? 'default';
      values.glass = box.glass ?? false;
      values.group = box.group ?? '';
      values.repeat = box.modelFit === 'repeat';
      values.yawDeg = tidy('yawDeg', box.yawDeg ?? 0);
      if (!many) {
        this.fieldControllers.push(folder.add(values, 'label').onFinishChange((v: string) => set('label', v)));
      }
      this.fieldControllers.push(folder.add(values, 'group').name('group (a folder in the list)').onFinishChange((v: string) => set('group', v.trim() === '' ? undefined : v.trim())));
      this.fieldControllers.push(folder.add(values, 'kind', ['prop', 'wall']).onChange((v: string) => set('kind', v)));
      this.fieldControllers.push(folder.add({ go: () => this.turnModels() }, 'go').name('Turn the model 90 deg in its box'));
      this.fieldControllers.push(folder.add(values, 'repeat').name('Repeat the model along the long side').onChange((v: boolean) => set('modelFit', v ? 'repeat' : undefined)));
      this.fieldControllers.push(folder.add({ go: () => this.fitBoxesToModels() }, 'go').name('Fit the box to its model'));
      this.fieldControllers.push(folder.add({ go: () => this.clearModels() }, 'go').name('No model (grey box)'));
      if (!many) {
        for (const field of ['xM', 'zM', 'widthM', 'depthM', 'heightM']) number(field);
        this.fieldControllers.push(numberField('yM', 0.05).name('yM (off the floor)').onFinishChange((v: number) => set('yM', v > 0 ? v : undefined)));
        this.fieldControllers.push(numberField('yawDeg', 5).name('yawDeg (turned, left)').onFinishChange((v: number) => set('yawDeg', normalYawDeg(v) || undefined)));
      }
      this.fieldControllers.push(folder.add(values, 'climbable').onChange((v: boolean) => set('climbable', v)));
      this.fieldControllers.push(folder.add(values, 'surface', ['default', 'concrete', 'metal', 'tile']).onChange((v: string) => set('surface', v === 'default' ? undefined : v)));
      this.fieldControllers.push(folder.add(values, 'glass').name('glass (5.4)').onChange((v: boolean) => set('glass', v ? true : undefined)));
      values.ramp = box.ramp ?? 'none';
      values.drawn = box.drawn !== false;
      values.solid = box.solid !== false;
      this.fieldControllers.push(folder.add(values, 'ramp', ['none', ...rampRises]).name('ramp (rises toward)').onChange((v: string) => set('ramp', v === 'none' ? undefined : v)));
      this.fieldControllers.push(folder.add(values, 'drawn').name('drawn (off: a stair ramp)').onChange((v: boolean) => set('drawn', v ? undefined : false)));
      this.fieldControllers.push(folder.add(values, 'solid').name('solid (off: stair steps)').onChange((v: boolean) => set('solid', v ? undefined : false)));
    } else if (!many) {
      number('xM');
      number('zM');
      number('yawDeg', 15);
      if (where.list === 'spawns') this.fieldControllers.push(folder.add(values, 'role', roles).onChange((v: string) => set('role', v)));
    }
    folder.open();
  }
}

/** The ids with `id` added, or taken away if it was there (Shift-click); the one just added is the main one. */
function toggled(ids: readonly Pick[], id: Pick): Pick[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

function describe(level: LevelData, pick: Pick, item: LevelBox | LevelSpot): string {
  const at = `at (${item.xM.toFixed(2)}, ${item.zM.toFixed(2)})`;
  const list = locate(level, pick)?.list;
  if (list === 'boxes') {
    const box = item as LevelBox;
    const m = (value: number) => tidy('M', value);
    return `${box.label} [${box.id}]${box.group ? ` in "${box.group}"` : ''} ${at}, ${m(box.widthM)} x ${m(box.depthM)} x ${m(box.heightM)} m${box.yM ? `, ${m(box.yM)} m up` : ''}${box.yawDeg ? `, turned ${tidy('Deg', box.yawDeg)} deg` : ''}`;
  }
  const facing = `facing ${tidy('Deg', (item as LevelSpot).yawDeg)} deg`;
  if (list === 'start') return `Rook's start ${at}, ${facing}`;
  if (list === 'dummies') return `dummy [${item.id}] ${at}, ${facing}`;
  return `enemy spawn [${item.id}] (${(item as LevelSpot & { role: string }).role}) ${at}, ${facing}`;
}

/** A box as the editor draws it; one the game does not draw (a stair's ramp) is a see-through violet, so it can be found. */
function boxMesh(box: LevelBox, selected: boolean): THREE.Mesh {
  const geometry = boxGeometry(box);
  const hidden = box.drawn === false;
  const material = new THREE.MeshStandardMaterial({
    color: hidden ? colours.hidden : box.glass ? colours.glass : colours[box.kind],
    transparent: hidden || box.glass === true,
    opacity: hidden ? 0.25 : box.glass ? 0.35 : 1,
    depthWrite: !hidden,
    emissive: selected ? colours.selected : 0x000000,
    emissiveIntensity: selected ? 0.6 : 0,
  });
  return new THREE.Mesh(geometry, material);
}

/** A marker: an upright post with a nub on the side it faces. */
function markerMesh(spot: LevelSpot, colour: number, selected: boolean): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(markerWidthM * 0.6, markerHeightM, markerWidthM * 0.6);
  geometry.translate(0, markerHeightM / 2, 0);
  const nub = new THREE.BoxGeometry(0.15, 0.15, 0.35);
  nub.translate(0, markerHeightM * 0.8, -0.3); // toward -z: the way yaw 0 faces
  const material = new THREE.MeshStandardMaterial({ color: colour, emissive: selected ? colours.selected : 0x000000, emissiveIntensity: selected ? 0.6 : 0 });
  const post = new THREE.Mesh(geometry, material);
  post.add(new THREE.Mesh(nub, material));
  // A marker's mesh is placed by its position (a box is built in place), so it sits in a holder.
  post.position.set(spot.xM, 0, spot.zM);
  post.rotation.y = (spot.yawDeg * Math.PI) / 180;
  const holder = new THREE.Group();
  holder.add(post);
  return holder;
}

function disposeMesh(object: THREE.Object3D): void {
  for (const child of object.children) disposeMesh(child);
  if (object.userData.shared) return; // part of a loaded model, drawn again later
  const mesh = object as Partial<THREE.Mesh>;
  mesh.geometry?.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material?.dispose();
}
