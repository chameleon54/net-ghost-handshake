import * as THREE from 'three';
import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import type { Input } from '../core/input';
import { roles } from '../config/roles';
import { isClimbable, rampRises } from '../data/greyboxRoom';
import { boxGeometry } from '../level/greybox';
import { LevelError, levelToJson, type LevelBox, type LevelData, type LevelSpot } from '../level/levelData';
import { addBox, addMarker, boxPresets, duplicate, EditHistory, markerHeightM, markerWidthM, moveBy, pickAt, picked, remove, setField, turn, type BoxPreset, type Pick } from '../level/levelEdit';
import { levelNameHeader, levelSaveUrl } from '../level/levelSave';

// The in-game level editor (milestone 5.2, decision 273), dev server only. F2 turns it on, with the free camera: aim at a
// piece or marker and click to pick it; arrows move it (Shift: 1 m), Page Up and Page Down raise and lower it, R turns it
// 90 degrees, N duplicates it, Delete removes it, U undoes. Its fields can be typed into in the panel (Esc to reach it).
// Save sends the level to the dev server, which writes src/data/levels/<name>.json; the page then reloads with it, and
// only then do collision, routes, cover and enemies use the new layout. Until then it draws its own copy of the boxes.

const stepM = 0.25;
const bigStepM = 1;
/** New pieces go this far in front of the camera, on the floor. */
const placeAheadM = 4;
const colours = { wall: 0x4a4f55, prop: 0x8a9097, glass: 0x7fc8e8, hidden: 0xb79cff, start: 0x33dd66, dummy: 0xe8e8e8, selected: 0xffc23d } as const;
const roleColours = { trooper: 0x6b7f3a, flanker: 0x9fb4c8, heavy: 0x222222, leader: 0x8a2a2a } as const;
const keyHelp = 'click pick · arrows move (Shift 1 m) · PgUp/PgDn height · R turn · N copy · Del delete · U undo · Esc panel · F2 off';

interface Parts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gui: GUI;
  /** The level as loaded, and the meshes the game draws its boxes with (hidden while the copy here is shown). */
  level: LevelData;
  boxMeshes: readonly THREE.Mesh[];
  /** Turns the free camera on or off. */
  setFreeCamera: (on: boolean) => void;
}

export class EditMode {
  active = false;
  private data: LevelData;
  private readonly savedJson: string;
  private pick: Pick | null = null;
  private readonly history = new EditHistory();
  private readonly group = new THREE.Group();
  private readonly selectedFolder: GUI;
  private fieldControllers: Controller[] = [];
  private message = '';
  private readonly crosshair = document.createElement('div');
  private readonly ray = new THREE.Vector3();

  constructor(private readonly parts: Parts) {
    this.data = parts.level;
    this.savedJson = JSON.stringify(parts.level);
    this.group.visible = false;
    parts.scene.add(this.group);
    this.crosshair.style.cssText =
      'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#ffc23d;' +
      'box-shadow:0 0 0 1px #000;pointer-events:none;z-index:11;display:none';
    document.body.appendChild(this.crosshair);

    const folder = parts.gui.addFolder(`Level editor (5.2): ${parts.level.name}`);
    folder.close();
    folder.add({ toggle: () => this.toggle(!this.active) }, 'toggle').name('Edit mode on or off (F2)');
    folder.add({ save: () => void this.save() }, 'save').name('Save to the level file');
    folder.add({ undo: () => this.undo() }, 'undo').name('Undo (U)');
    const adds = folder.addFolder('Add (where you look)');
    for (const preset of Object.keys(boxPresets) as BoxPreset[]) adds.add({ add: () => this.addPiece(preset) }, 'add').name(`Add ${preset}`);
    adds.add({ add: () => this.addSpot('dummies') }, 'add').name('Add dummy');
    adds.add({ add: () => this.addSpot('spawns') }, 'add').name('Add enemy spawn');
    folder.add({ copy: () => this.duplicatePick() }, 'copy').name('Duplicate (N)');
    folder.add({ del: () => this.removePick() }, 'del').name('Delete (Del)');
    this.selectedFolder = folder.addFolder('Selected');
  }

  toggle(on: boolean): void {
    this.active = on;
    this.parts.setFreeCamera(on);
    this.crosshair.style.display = on ? 'block' : 'none';
    this.redraw();
  }

  /** True while the copy here differs from the level as loaded (and saved). */
  get dirty(): boolean {
    return JSON.stringify(this.data) !== this.savedJson;
  }

  /** Once per frame while it is on: picking and the keys. */
  update(input: Input): void {
    if (!this.active) return;
    const { camera } = this.parts;
    if (input.consumeButtonPress(0)) {
      camera.getWorldDirection(this.ray);
      this.select(pickAt(this.data, camera.position, this.ray));
    }
    if (input.consumePress('KeyU')) this.undo();
    if (!this.pick) return;
    const step = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight') ? bigStepM : stepM;
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
    const what = !this.pick || !item ? 'nothing (aim and click)' : describe(this.pick, item);
    return [
      `EDITOR    ${this.data.name}: ${this.data.boxes.length} boxes, ${this.data.spawns.length} spawns, ${this.data.dummies.length} dummies${this.dirty ? ', UNSAVED changes (collision and enemies still use the saved layout)' : ', saved'}`,
      `selected  ${what}`,
      `keys      ${keyHelp}`,
      ...(this.message ? [`note      ${this.message}`] : []),
    ];
  }

  private select(pick: Pick | null): void {
    this.pick = pick;
    this.message = '';
    this.redraw();
    this.showFields();
  }

  /** A change: remembered for undo, then drawn. `pick` replaces the selection if given. */
  private change(next: LevelData, pick?: Pick | null): void {
    this.history.push(this.data);
    this.data = next;
    if (pick !== undefined) this.pick = pick;
    this.message = '';
    this.redraw();
    this.showFields();
  }

  private undo(): void {
    const before = this.history.undo();
    if (!before) {
      this.message = 'nothing to undo';
      return;
    }
    this.data = before;
    if (this.pick && !picked(this.data, this.pick)) this.pick = null;
    this.redraw();
    this.showFields();
  }

  /** Where a new piece goes: on the floor, `placeAheadM` in front of the camera. */
  private placeAt(): { x: number; z: number } {
    const { camera } = this.parts;
    camera.getWorldDirection(this.ray);
    const flat = Math.hypot(this.ray.x, this.ray.z) || 1;
    return { x: snap(camera.position.x + (this.ray.x / flat) * placeAheadM), z: snap(camera.position.z + (this.ray.z / flat) * placeAheadM) };
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

  /** Draws the copy of the level (boxes and markers) once it differs from the loaded one, or while editing. */
  private redraw(): void {
    const show = this.active || this.dirty;
    for (const mesh of this.parts.boxMeshes) mesh.visible = !show;
    this.group.visible = show;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeMesh(child as THREE.Mesh);
    }
    if (!show) return;
    const isPicked = (list: Pick['list'], index: number) => this.pick !== null && this.pick.list === list && this.pick.index === index;
    this.data.boxes.forEach((box, i) => this.group.add(boxMesh(box, isPicked('boxes', i))));
    this.group.add(markerMesh(this.data.start, colours.start, isPicked('start', 0)));
    this.data.dummies.forEach((spot, i) => this.group.add(markerMesh(spot, colours.dummy, isPicked('dummies', i))));
    this.data.spawns.forEach((spot, i) => this.group.add(markerMesh(spot, roleColours[spot.role], isPicked('spawns', i))));
  }

  /** The panel's "Selected" folder: the picked item's fields, typed into to change them. */
  private showFields(): void {
    for (const controller of this.fieldControllers) controller.destroy();
    this.fieldControllers = [];
    const pick = this.pick;
    const item = pick ? picked(this.data, pick) : undefined;
    if (!pick || !item) return;
    const folder = this.selectedFolder;
    const set = (field: string, value: unknown) => this.change(setField(this.data, pick, field, value));
    const values: Record<string, unknown> = { ...item };
    const number = (field: string, step = 0.05) =>
      this.fieldControllers.push(folder.add(values, field).step(step).onFinishChange((v: number) => set(field, v)));
    if (pick.list === 'boxes') {
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
      if (pick.list === 'spawns') this.fieldControllers.push(folder.add(values, 'role', roles).onChange((v: string) => set('role', v)));
    }
    folder.open();
  }
}

/** Snaps to the editor's step, so new pieces line up. */
function snap(m: number): number {
  return Math.round(m / stepM) * stepM;
}

function describe(pick: Pick, item: LevelBox | LevelSpot): string {
  const at = `at (${item.xM.toFixed(2)}, ${item.zM.toFixed(2)})`;
  if (pick.list === 'boxes') {
    const box = item as LevelBox;
    return `${box.label} [${box.id}] ${at}, ${box.widthM} x ${box.depthM} x ${box.heightM} m${box.yM ? `, ${box.yM} m up` : ''}`;
  }
  const facing = `facing ${(item as LevelSpot).yawDeg} deg`;
  if (pick.list === 'start') return `Rook's start ${at}, ${facing}`;
  if (pick.list === 'dummies') return `dummy ${pick.index + 1} ${at}, ${facing}`;
  return `enemy spawn ${pick.index + 1} (${(item as LevelSpot & { role: string }).role}) ${at}, ${facing}`;
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
function markerMesh(spot: LevelSpot, colour: number, selected: boolean): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(markerWidthM * 0.6, markerHeightM, markerWidthM * 0.6);
  geometry.translate(0, markerHeightM / 2, 0);
  const nub = new THREE.BoxGeometry(0.15, 0.15, 0.35);
  nub.translate(0, markerHeightM * 0.8, -0.3); // toward -z: the way yaw 0 faces
  const material = new THREE.MeshStandardMaterial({ color: colour, emissive: selected ? colours.selected : 0x000000, emissiveIntensity: selected ? 0.6 : 0 });
  const post = new THREE.Mesh(geometry, material);
  post.add(new THREE.Mesh(nub, material));
  post.position.set(spot.xM, 0, spot.zM);
  post.rotation.y = (spot.yawDeg * Math.PI) / 180;
  return post;
}

function disposeMesh(mesh: THREE.Mesh): void {
  for (const child of mesh.children) disposeMesh(child as THREE.Mesh);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}
