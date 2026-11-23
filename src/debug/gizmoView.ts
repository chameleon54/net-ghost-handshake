import * as THREE from 'three';
import { arrowStart, handleHalfSize, type GizmoHandle } from '../level/gizmo';

// Draws the editor's arrows and size handles (5.2c, decision 285; the maths is in src/level/gizmo.ts). Always on top of the
// level and the same size on screen. Dev server only.

const axisColours = { x: 0xff4d4d, y: 0x4dff6a, z: 0x4d8dff } as const;
const sizeColours = { x: 0xff9a9a, y: 0x9aff9a, z: 0x9ab8ff } as const;
const hoverColour = 0xffffff;
const activeColour = 0xffc23d;
/** Drawn after everything else, with no depth test, so a handle inside or behind a piece can still be seen and aimed at. */
const drawOrder = 1000;

interface Part {
  root: THREE.Group;
  material: THREE.MeshBasicMaterial;
}

export class GizmoView {
  readonly group = new THREE.Group();
  private readonly parts = new Map<string, Part>();

  constructor() {
    this.group.visible = false;
  }

  /** Once per frame: shows these handles (and hides the rest); `hoverKey` is lit white, `activeKey` (being dragged) orange. */
  update(handles: readonly GizmoHandle[], hoverKey: string | null, activeKey: string | null): void {
    const live = new Set(handles.map((handle) => handle.key));
    for (const [key, part] of this.parts) part.root.visible = live.has(key);
    for (const handle of handles) {
      const part = this.parts.get(handle.key) ?? this.make(handle);
      part.root.visible = true;
      part.root.scale.setScalar(handle.scale);
      const where = handle.kind === 'move' ? handle.origin : handle.at;
      part.root.position.set(where.x, where.y, where.z);
      const base = (handle.kind === 'move' ? axisColours : sizeColours)[handle.axis];
      part.material.color.setHex(handle.key === activeKey ? activeColour : handle.key === hoverKey ? hoverColour : base);
    }
    this.group.visible = handles.length > 0;
  }

  /** Hides everything (the editor is off, or nothing is selected). */
  hide(): void {
    this.group.visible = false;
  }

  /** An arrow: a shaft and a cone along +y, turned to its axis; or a handle: a small cube. Built once, in gizmo units (1 = `scale` metres). */
  private make(handle: GizmoHandle): Part {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 });
    const root = new THREE.Group();
    if (handle.kind === 'move') {
      const shaftLength = 0.85;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, shaftLength - arrowStart, 0.03), material);
      shaft.position.y = (shaftLength + arrowStart) / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1 - shaftLength, 10), material);
      tip.position.y = shaftLength + (1 - shaftLength) / 2;
      root.add(shaft, tip);
      if (handle.axis === 'x') root.rotation.z = -Math.PI / 2; // +y turned to +x
      if (handle.axis === 'z') root.rotation.x = Math.PI / 2; // +y turned to +z
    } else {
      root.add(new THREE.Mesh(new THREE.BoxGeometry(handleHalfSize * 2, handleHalfSize * 2, handleHalfSize * 2), material));
    }
    root.traverse((object) => (object.renderOrder = drawOrder));
    this.group.add(root);
    const part = { root, material };
    this.parts.set(handle.key, part);
    return part;
  }
}
