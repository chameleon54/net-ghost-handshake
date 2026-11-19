import * as THREE from 'three';
import GUI, { type Controller } from 'lil-gui';
import type { Input } from '../core/input';
import { roles } from '../config/roles';
import { playerConfig } from '../config/player';
import { isClimbable, rampRises } from '../data/greyboxRoom';
import { boxGeometry, buildGreybox } from '../level/greybox';
import { LevelError, levelLayout, levelToJson, type LevelBox, type LevelData, type LevelSpot } from '../level/levelData';
import {
  addBox,
  addMarker,
  boxPresets,
  dragOnFloor,
  duplicate,
  EditHistory,
  locate,
  markerHeightM,
  markerWidthM,
  moveBy,
  pickAt,
  picked,
  remove,
  setField,
  snapTo,
  turn,
  type BoxPreset,
  type Pick,
} from '../level/levelEdit';
import { levelNameHeader, levelSaveUrl } from '../level/levelSave';
import { Navigation } from '../level/navigation';
import { describeReach, newSince, reachProblems, type ReachProblem } from '../level/reach';

// The in-game level editor (milestone 5.2, decision 273; 5.2b, decision 281), dev server only. F2 turns it on, with the
// free camera: aim at a piece or marker and click to pick it; hold the right button and move the mouse to drag it on the
// floor (the wheel raises it; Shift snaps to the 0.25 m grid); arrows move it too (Shift: 1 m), Page Up and Page Down
// raise and lower it, R turns it 90 degrees, N duplicates it, Delete removes it, U undoes. Its own panel sits bottom left
// (Esc frees the mouse to use it). A moment after each change it rebuilds the walkable floor from its copy and reports
// what the enemies or Rook can no longer walk to (src/level/reach.ts). Save sends the level to the dev server, which writes
// src/data/levels/<name>.json; the page then reloads with it, and only then do collision, routes, cover and enemies use
// the new layout. Until then it draws its own copy of the boxes.

const stepM = 0.25;
const bigStepM = 1;
/** A drag rounds to this, or to `stepM` with Shift held. */
const dragStepM = 0.05;
/** How far a piece moves per count of mouse movement while dragged. */
const dragMetresPerCount = 0.01;
/** New pieces go this far in front of the camera, on the floor. */
const placeAheadM = 4;
/** The reach check runs this long after the last change (so a run of key presses builds once). */
const previewAfterSec = 0.3;
const rightButton = 2;
const colours = { wall: 0x4a4f55, prop: 0x8a9097, glass: 0x7fc8e8, hidden: 0xb79cff, start: 0x33dd66, dummy: 0xe8e8e8, selected: 0xffc23d } as const;
const roleColours = { trooper: 0x6b7f3a, flanker: 0x9fb4c8, heavy: 0x222222, leader: 0x8a2a2a } as const;
const previewColours = { mesh: 0x3fd0ff, problem: 0xff2a2a } as const;
const keyHelp = 'click pick · hold right button drag (wheel height, Shift grid) · arrows move · PgUp/PgDn height · R turn · N copy · Del delete · U undo · Esc panel · F2 off';

interface Parts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The level as loaded, and the meshes the game draws its boxes with (hidden while the copy here is shown). */
  level: LevelData;
  boxMeshes: readonly THREE.Mesh[];
  /** Turns the free camera on or off. */
  setFreeCamera: (on: boolean) => void;
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
  private pick: Pick | null = null;
  private readonly history = new EditHistory();
  private readonly group = new THREE.Group();
  /** The drawn copy's meshes by id, so a drag can move just the one. */
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly panelBox = document.createElement('div');
  private readonly panel: GUI;
  private readonly selectedFolder: GUI;
  private fieldControllers: Controller[] = [];
  private message = '';
  private readonly crosshair = document.createElement('div');
  private readonly ray = new THREE.Vector3();
  private readonly mouse = { x: 0, y: 0 };
  /** While the right button drags: the level before the drag (one undo step), where the item started, and how far it has gone. */
  private drag: { before: LevelData; startX: number; startZ: number; startY: number; dx: number; dz: number; dy: number } | null = null;
  // The reach preview.
  private readonly previewGroup = new THREE.Group();
  private baseline: ReachProblem[] | null = null;
  private reachLines: string[] = [];
  private previewLeftSec = -1;
  private previewRun = 0;

  constructor(private readonly parts: Parts) {
    this.data = parts.level;
    this.savedJson = JSON.stringify(parts.level);
    this.group.visible = false;
    parts.scene.add(this.group);
    this.previewGroup.visible = false;
    parts.scene.add(this.previewGroup);
    this.crosshair.style.cssText =
      'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#ffc23d;' +
      'box-shadow:0 0 0 1px #000;pointer-events:none;z-index:11;display:none';
    document.body.appendChild(this.crosshair);

    // Its own panel, bottom left, shown while the editor is on (5.2b).
    this.panelBox.style.cssText = 'position:fixed;left:8px;bottom:8px;max-height:60vh;overflow-y:auto;z-index:12;display:none';
    document.body.appendChild(this.panelBox);
    this.panel = new GUI({ container: this.panelBox, title: `Level editor: ${parts.level.name} (Esc to use)`, width: 300 });
    this.panel.add({ save: () => void this.save() }, 'save').name('Save to the level file');
    this.panel.add({ undo: () => this.undo() }, 'undo').name('Undo (U)');
    const adds = this.panel.addFolder('Add (where you look)');
    adds.close();
    for (const preset of Object.keys(boxPresets) as BoxPreset[]) adds.add({ add: () => this.addPiece(preset) }, 'add').name(`Add ${preset}`);
    adds.add({ add: () => this.addSpot('dummies') }, 'add').name('Add dummy');
    adds.add({ add: () => this.addSpot('spawns') }, 'add').name('Add enemy spawn');
    this.panel.add({ copy: () => this.duplicatePick() }, 'copy').name('Duplicate (N)');
    this.panel.add({ del: () => this.removePick() }, 'del').name('Delete (Del)');
    this.panel.add(this.previewGroup, 'visible').name('Show the reach preview');
    this.selectedFolder = this.panel.addFolder('Selected');
  }

  toggle(on: boolean): void {
    this.active = on;
    this.parts.setFreeCamera(on);
    this.crosshair.style.display = on ? 'block' : 'none';
    this.panelBox.style.display = on ? 'block' : 'none';
    if (!on) this.endDrag();
    if (on && this.baseline === null) void this.measureBaseline();
    this.redraw();
  }

  /** True while the copy here differs from the level as loaded (and saved). */
  get dirty(): boolean {
    return JSON.stringify(this.data) !== this.savedJson;
  }

  /** Once per frame while it is on: picking, dragging, the keys, and the reach preview's timer. */
  update(input: Input, dtSec = 0): void {
    if (this.previewLeftSec >= 0 && !this.drag) {
      this.previewLeftSec -= dtSec;
      if (this.previewLeftSec < 0) void this.preview();
    }
    if (!this.active) return;
    const { camera } = this.parts;
    if (input.consumeButtonPress(0)) {
      camera.getWorldDirection(this.ray);
      this.select(pickAt(this.data, camera.position, this.ray));
    }
    if (input.consumePress('KeyU')) this.undo();
    if (!this.pick) return;
    const shift = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
    if (input.isButtonDown(rightButton)) this.dragStep(input, shift);
    else if (this.drag) this.endDrag();
    if (this.drag) return; // keys wait until the drag is over
    const step = shift ? bigStepM : stepM;
    // Arrows move along the floor axis nearest to where you look, so "up" is always away from you.
    camera.getWorldDirection(this.ray);
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
      if (input.consumePress(key)) this.change(moveBy(this.data, this.pick, dx * step, dy * step, dz * step));
    }
    if (input.consumePress('KeyR')) this.change(turn(this.data, this.pick));
    if (input.consumePress('KeyN')) this.duplicatePick();
    if (input.consumePress('Delete')) this.removePick();
  }

  /** The editor's lines for the readout box (shown in place of the usual readouts while it is on). */
  lines(): string[] {
    const item = this.pick ? picked(this.data, this.pick) : undefined;
    const what = !this.pick || !item ? 'nothing (aim and click)' : describe(this.data, this.pick, item);
    return [
      `EDITOR    ${this.data.name}: ${this.data.boxes.length} boxes, ${this.data.spawns.length} spawns, ${this.data.dummies.length} dummies${this.dirty ? ', UNSAVED changes (collision and enemies still use the saved layout)' : ', saved'}`,
      `selected  ${what}${this.drag ? ' (dragging)' : ''}`,
      `keys      ${keyHelp}`,
      ...this.reachLines.map((line, i) => `${i === 0 ? 'reach     ' : '          '}${line}`),
      ...(this.message ? [`note      ${this.message}`] : []),
    ];
  }

  /** One frame of a right-button drag: the mouse moves the piece on the floor, the wheel raises a box. */
  private dragStep(input: Input, shift: boolean): void {
    if (!this.pick) return;
    const item = picked(this.data, this.pick);
    if (!item) return;
    if (!this.drag) {
      const yM = (item as LevelBox).yM ?? 0;
      this.drag = { before: this.data, startX: item.xM, startZ: item.zM, startY: yM, dx: 0, dz: 0, dy: 0 };
    }
    input.consumeMouseMove(this.mouse); // taken here, so the free camera holds still meanwhile
    const moved = dragOnFloor(this.parts.camera.rotation.y, this.mouse.x, this.mouse.y, dragMetresPerCount);
    this.drag.dx += moved.dx;
    this.drag.dz += moved.dz;
    const isBox = locate(this.data, this.pick)?.list === 'boxes';
    if (isBox) this.drag.dy += input.consumeWheelSteps() * stepM;
    const snap = shift ? stepM : dragStepM;
    const x = snapTo(this.drag.startX + this.drag.dx, snap);
    const z = snapTo(this.drag.startZ + this.drag.dz, snap);
    const y = Math.max(snapTo(this.drag.startY + this.drag.dy, stepM), 0);
    let next = setField(setField(this.data, this.pick, 'xM', x), this.pick, 'zM', z);
    if (isBox) next = setField(next, this.pick, 'yM', y > 0 ? y : undefined);
    if (next === this.data) return;
    this.data = next;
    // Only the dragged mesh moves while dragging (its geometry was built where it started); the rest is redrawn at the end.
    const mesh = this.meshes.get(this.pick);
    if (mesh) mesh.position.set(x - this.drag.startX, isBox ? y - this.drag.startY : 0, z - this.drag.startZ);
  }

  /** The drag is over: it becomes one undo step, and the reach preview runs. */
  private endDrag(): void {
    if (!this.drag) return;
    const { before } = this.drag;
    this.drag = null;
    if (this.data !== before) {
      this.history.push(before);
      this.afterChange();
    }
  }

  private select(pick: Pick | null): void {
    this.pick = pick;
    this.message = '';
    this.redraw();
    this.showFields();
  }

  /** A change: remembered for undo, then drawn. `pick` replaces the selection if given. */
  private change(next: LevelData, pick?: Pick | null): void {
    if (next === this.data) return;
    this.history.push(this.data);
    this.data = next;
    if (pick !== undefined) this.pick = pick;
    this.afterChange();
  }

  private afterChange(): void {
    this.message = '';
    this.redraw();
    this.showFields();
    this.previewLeftSec = previewAfterSec;
  }

  private undo(): void {
    const before = this.history.undo();
    if (!before) {
      this.message = 'nothing to undo';
      return;
    }
    this.data = before;
    if (this.pick && !picked(this.data, this.pick)) this.pick = null;
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
    this.change(added.level, added.pick);
  }

  private addSpot(list: 'dummies' | 'spawns'): void {
    const at = this.placeAt();
    const added = addMarker(this.data, list, at.x, at.z);
    this.change(added.level, added.pick);
  }

  private duplicatePick(): void {
    if (!this.pick) return;
    const copy = duplicate(this.data, this.pick);
    if (!copy) {
      this.message = "Rook's start cannot be copied";
      return;
    }
    this.change(copy.level, copy.pick);
  }

  private removePick(): void {
    if (!this.pick) return;
    const next = remove(this.data, this.pick);
    if (!next) {
      this.message = "Rook's start cannot be deleted";
      return;
    }
    this.change(next, null);
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
    const add = (id: string, mesh: THREE.Object3D) => {
      this.meshes.set(id, mesh);
      this.group.add(mesh);
    };
    for (const box of this.data.boxes) add(box.id, boxMesh(box, box.id === this.pick));
    add(this.data.start.id, markerMesh(this.data.start, colours.start, this.data.start.id === this.pick));
    for (const spot of this.data.dummies) add(spot.id, markerMesh(spot, colours.dummy, spot.id === this.pick));
    for (const spot of this.data.spawns) add(spot.id, markerMesh(spot, roleColours[spot.role], spot.id === this.pick));
  }

  /** The panel's "Selected" folder: the picked item's fields, typed into to change them. */
  private showFields(): void {
    for (const controller of this.fieldControllers) controller.destroy();
    this.fieldControllers = [];
    const pick = this.pick;
    const item = pick ? picked(this.data, pick) : undefined;
    const where = pick ? locate(this.data, pick) : undefined;
    if (!pick || !item || !where) return;
    const folder = this.selectedFolder;
    const set = (field: string, value: unknown) => this.change(setField(this.data, pick, field, value));
    const values: Record<string, unknown> = { ...item };
    const number = (field: string, step = 0.05) =>
      this.fieldControllers.push(folder.add(values, field).step(step).onFinishChange((v: number) => set(field, v)));
    if (where.list === 'boxes') {
      const box = item as LevelBox;
      values.yM = box.yM ?? 0;
      values.climbable = isClimbable(box);
      values.surface = box.surface ?? 'default';
      values.glass = box.glass ?? false;
      this.fieldControllers.push(folder.add(values, 'label').onFinishChange((v: string) => set('label', v)));
      this.fieldControllers.push(folder.add(values, 'kind', ['prop', 'wall']).onChange((v: string) => set('kind', v)));
      for (const field of ['xM', 'zM', 'widthM', 'depthM', 'heightM']) number(field);
      this.fieldControllers.push(folder.add(values, 'yM').step(0.05).name('yM (off the floor)').onFinishChange((v: number) => set('yM', v > 0 ? v : undefined)));
      this.fieldControllers.push(folder.add(values, 'climbable').onChange((v: boolean) => set('climbable', v)));
      this.fieldControllers.push(folder.add(values, 'surface', ['default', 'concrete', 'metal', 'tile']).onChange((v: string) => set('surface', v === 'default' ? undefined : v)));
      this.fieldControllers.push(folder.add(values, 'glass').name('glass (5.4)').onChange((v: boolean) => set('glass', v ? true : undefined)));
      values.ramp = box.ramp ?? 'none';
      values.drawn = box.drawn !== false;
      values.solid = box.solid !== false;
      this.fieldControllers.push(folder.add(values, 'ramp', ['none', ...rampRises]).name('ramp (rises toward)').onChange((v: string) => set('ramp', v === 'none' ? undefined : v)));
      this.fieldControllers.push(folder.add(values, 'drawn').name('drawn (off: a stair ramp)').onChange((v: boolean) => set('drawn', v ? undefined : false)));
      this.fieldControllers.push(folder.add(values, 'solid').name('solid (off: stair steps)').onChange((v: boolean) => set('solid', v ? undefined : false)));
    } else {
      number('xM');
      number('zM');
      number('yawDeg', 15);
      if (where.list === 'spawns') this.fieldControllers.push(folder.add(values, 'role', roles).onChange((v: string) => set('role', v)));
    }
    folder.open();
  }
}

function describe(level: LevelData, pick: Pick, item: LevelBox | LevelSpot): string {
  const at = `at (${item.xM.toFixed(2)}, ${item.zM.toFixed(2)})`;
  const list = locate(level, pick)?.list;
  if (list === 'boxes') {
    const box = item as LevelBox;
    return `${box.label} [${box.id}] ${at}, ${box.widthM} x ${box.depthM} x ${box.heightM} m${box.yM ? `, ${box.yM} m up` : ''}`;
  }
  const facing = `facing ${(item as LevelSpot).yawDeg} deg`;
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
  // A marker's mesh is placed by its position (not built in place like a box), so a drag moves it by setting the
  // position: it sits in a holder that the drag offsets.
  post.position.set(spot.xM, 0, spot.zM);
  post.rotation.y = (spot.yawDeg * Math.PI) / 180;
  const holder = new THREE.Group();
  holder.add(post);
  return holder;
}

function disposeMesh(object: THREE.Object3D): void {
  for (const child of object.children) disposeMesh(child);
  const mesh = object as Partial<THREE.Mesh>;
  mesh.geometry?.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material?.dispose();
}
