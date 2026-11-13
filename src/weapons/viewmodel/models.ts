import * as THREE from 'three';
import type { WeaponId } from '../events';

// The weapons, built from simple boxes and cylinders in code (the fallback assets.md allows: no downloads, no licences).
// Each gun is separate pieces so the animation can move them. Local space: forward is -z, up is +y, right is +x,
// with the origin in the middle of the receiver (rifle), frame (pistol) or handle (knife). Sizes are in metres.
// The hands are named anchors (`handStrong`, `handOff`) holding plain gloved blocks. A hand with fingers can later
// replace the contents of an anchor without touching the animation or the rules.

export interface WeaponModel {
  root: THREE.Group;
  /** Moves down and away in a reload. Null for the knife. */
  mag: THREE.Object3D | null;
  /** The slide (pistol) or charging handle (rifle) that cycles on a shot. Null for the knife. */
  slide: THREE.Object3D | null;
  handStrong: THREE.Object3D;
  /** The hand that dips out of frame to fetch a magazine. Null for the knife. */
  handOff: THREE.Object3D | null;
  /** Where tracers start. Null for the knife. */
  muzzle: THREE.Object3D | null;
  /** Where spent casings leave the gun. Null for the knife. */
  ejection: THREE.Object3D | null;
  /** A brass casing sticking out of the port, shown while the gun is jammed. Null for the knife. */
  stuckCasing: THREE.Object3D | null;
  /** Where the root sits in the camera's space when hanging at rest, and when fully aimed. */
  rest: { x: number; y: number; z: number; pitchRad: number; yawRad: number; rollRad: number };
  aimed: { x: number; y: number; z: number };
  /** The parts' rest places, so the pose can be added to them. */
  base: { magY: number; slideZ: number; handOff: THREE.Vector3 };
}

const colours = {
  metal: 0x2f343a,
  dark: 0x23272b,
  magazine: 0x3a4047,
  suppressor: 0x15181b,
  glove: 0x14171a,
  blade: 0xc5ced6,
  handle: 0x2a2d31,
  sight: 0x0f1113,
  brass: 0xc9a227,
} as const;


const materials = new Map<number, THREE.MeshStandardMaterial>();
function material(colour: number): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7, metalness: 0.2 });
    materials.set(colour, m);
  }
  return m;
}

/** A box of the given size (width, height, length) centred at x, y, z inside `parent`. */
function box(parent: THREE.Object3D, w: number, h: number, l: number, colour: number, x: number, y: number, z: number, pitchRad = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), material(colour));
  mesh.position.set(x, y, z);
  mesh.rotation.x = pitchRad;
  parent.add(mesh);
  return mesh;
}

/** A cylinder lying along the gun (pointing forward). */
function barrel(parent: THREE.Object3D, radiusM: number, lengthM: number, colour: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusM, radiusM, lengthM, 12), material(colour));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function anchor(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

const noRotation = { pitchRad: 0, yawRad: 0, rollRad: 0 };

function buildRifle(): WeaponModel {
  const root = new THREE.Group();
  box(root, 0.06, 0.09, 0.34, colours.metal, 0, 0, 0); // receiver
  box(root, 0.055, 0.06, 0.22, colours.dark, 0, -0.005, -0.28); // handguard
  barrel(root, 0.011, 0.3, colours.metal, 0, 0.005, -0.54);
  barrel(root, 0.016, 0.05, colours.suppressor, 0, 0.005, -0.69); // muzzle brake
  box(root, 0.045, 0.085, 0.18, colours.dark, 0, -0.01, 0.26); // stock
  box(root, 0.034, 0.1, 0.04, colours.dark, 0, -0.085, 0.1, 0.25); // grip
  box(root, 0.008, 0.02, 0.015, colours.sight, 0, -0.055, 0.04); // trigger
  box(root, 0.008, 0.03, 0.008, colours.sight, 0, 0.055, -0.4); // front sight
  box(root, 0.02, 0.02, 0.02, colours.sight, 0, 0.055, 0.1); // rear sight
  const mag = box(root, 0.03, 0.13, 0.05, colours.magazine, 0, -0.105, -0.03);
  const slide = box(root, 0.018, 0.02, 0.05, colours.sight, 0.04, 0.02, 0.05); // charging handle on the right
  const handStrong = anchor(root, 0, -0.125, 0.1);
  box(handStrong, 0.045, 0.06, 0.09, colours.glove, 0, 0, 0);
  const handOff = anchor(root, 0, -0.06, -0.3);
  box(handOff, 0.06, 0.055, 0.1, colours.glove, 0, 0, 0);
  const muzzle = anchor(root, 0, 0.005, -0.72);
  const ejection = anchor(root, 0.035, 0.03, 0.0); // the port on the right of the receiver
  const stuckCasing = box(root, 0.025, 0.012, 0.035, colours.brass, 0.045, 0.03, 0.0);
  stuckCasing.visible = false;
  return {
    root, mag, slide, handStrong, handOff, muzzle, ejection, stuckCasing,
    rest: { x: 0.17, y: -0.2, z: -0.4, ...noRotation },
    aimed: { x: 0, y: -0.095, z: -0.4 },
    base: { magY: mag.position.y, slideZ: slide.position.z, handOff: handOff.position.clone() },
  };
}

function buildPistol(): WeaponModel {
  const root = new THREE.Group();
  box(root, 0.026, 0.05, 0.15, colours.metal, 0, 0, 0); // frame
  const slide = box(root, 0.03, 0.035, 0.17, colours.dark, 0, 0.04, -0.005); // slide
  barrel(root, 0.017, 0.14, colours.suppressor, 0, 0.04, -0.155); // suppressor, always fitted
  box(root, 0.028, 0.085, 0.045, colours.metal, 0, -0.065, 0.055, 0.15); // grip
  box(root, 0.008, 0.02, 0.015, colours.sight, 0, -0.025, 0.0); // trigger
  box(root, 0.008, 0.015, 0.008, colours.sight, 0, 0.065, -0.08); // front sight
  box(root, 0.02, 0.012, 0.012, colours.sight, 0, 0.065, 0.07); // rear sight
  const mag = box(root, 0.022, 0.075, 0.034, colours.magazine, 0, -0.1, 0.057);
  const handStrong = anchor(root, 0, -0.075, 0.065);
  box(handStrong, 0.045, 0.06, 0.07, colours.glove, 0, 0, 0);
  const handOff = anchor(root, -0.012, -0.1, 0.05);
  box(handOff, 0.05, 0.05, 0.06, colours.glove, 0, 0, 0);
  const muzzle = anchor(root, 0, 0.04, -0.23);
  const ejection = anchor(root, 0.016, 0.04, 0.0); // the slide's ejection port
  const stuckCasing = box(root, 0.02, 0.012, 0.03, colours.brass, 0.03, 0.05, 0.0);
  stuckCasing.visible = false;
  return {
    root, mag, slide, handStrong, handOff, muzzle, ejection, stuckCasing,
    rest: { x: 0.13, y: -0.17, z: -0.33, ...noRotation },
    aimed: { x: 0, y: -0.075, z: -0.33 },
    base: { magY: mag.position.y, slideZ: slide.position.z, handOff: handOff.position.clone() },
  };
}

function buildKnife(): WeaponModel {
  const root = new THREE.Group();
  box(root, 0.02, 0.022, 0.11, colours.handle, 0, 0, 0.04); // handle
  box(root, 0.03, 0.035, 0.012, colours.dark, 0, 0, -0.015); // guard
  box(root, 0.006, 0.032, 0.16, colours.blade, 0, 0, -0.1); // blade
  const handStrong = anchor(root, 0, -0.012, 0.05);
  box(handStrong, 0.04, 0.045, 0.06, colours.glove, 0, 0, 0);
  return {
    root, mag: null, slide: null, handStrong, handOff: null, muzzle: null, ejection: null, stuckCasing: null,
    // Held blade-up and angled across, ready to swing.
    rest: { x: 0.14, y: -0.17, z: -0.36, pitchRad: 0.6, yawRad: 0.3, rollRad: -0.2 },
    aimed: { x: 0.14, y: -0.17, z: -0.36 },
    base: { magY: 0, slideZ: 0, handOff: new THREE.Vector3() },
  };
}

export function buildModels(): Record<WeaponId, WeaponModel> {
  return { rifle: buildRifle(), pistol: buildPistol(), knife: buildKnife() };
}
