import * as THREE from 'three';
import type { StandInEnemy } from '../enemies/standInEnemy';
import type { CoverPoints } from '../level/cover';

const hidesColour = 0x2fd06a;
const exposedColour = 0xe0453a;
const chosenColour = 0xffe14a;
const sideColour = 0xffffff;
const postRadiusM = 0.05;
const lowPostM = 0.5;
const highPostM = 1.2;
const arrowLengthM = 0.25;
const arrowRadiusM = 0.08;
const sideTickM = { length: 0.3, thickness: 0.04 } as const; // a bar toward each open side of high cover (4.4)
const ringInnerM = 0.3;
const ringOuterM = 0.38;
const liftM = 0.03; // above the floor and its grid, so the ring does not flicker
const checksPerSec = 5; // the "hides from you" colours are rays, so they are not redone every frame

// Dev-only overlay for 4.3 and 4.4 (architecture.md, "debug overlays"): a post at each cover point, short for low cover and
// tall for high, with an arrow toward the cover and, on high cover, a white bar toward each side a peek can step out to.
// Green: it hides a body from you right now. Red: it does not. A yellow ring marks the spot each stand-in has chosen.
// Hidden until the dev panel tick shows it.
export class CoverOverlay {
  private readonly group = new THREE.Group();
  private readonly posts: THREE.Mesh[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(ringInnerM, ringOuterM, 24).rotateX(-Math.PI / 2);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: chosenColour, side: THREE.DoubleSide });
  private readonly hidesMaterial = new THREE.MeshBasicMaterial({ color: hidesColour });
  private readonly exposedMaterial = new THREE.MeshBasicMaterial({ color: exposedColour });
  private readonly sideMaterial = new THREE.MeshBasicMaterial({ color: sideColour });
  private timerSec = 0;

  constructor(
    scene: THREE.Scene,
    private readonly cover: CoverPoints,
    /** The stand-ins in the room (the list may change). */
    private readonly standIns: readonly StandInEnemy[],
    /** Your eyes (the camera). */
    private readonly eyes: THREE.Vector3,
  ) {
    const lowPost = new THREE.CylinderGeometry(postRadiusM, postRadiusM, lowPostM).translate(0, lowPostM / 2, 0);
    const highPost = new THREE.CylinderGeometry(postRadiusM, postRadiusM, highPostM).translate(0, highPostM / 2, 0);
    // The arrow points along -z in its own space (yaw 0 = north), so turning the marker by the spot's yaw aims it at the cover.
    const arrow = new THREE.ConeGeometry(arrowRadiusM, arrowLengthM).rotateX(-Math.PI / 2);
    const sideBar = new THREE.BoxGeometry(sideTickM.length, sideTickM.thickness, sideTickM.thickness);
    for (const point of cover.points) {
      const postHeightM = point.height === 'low' ? lowPostM : highPostM;
      const post = new THREE.Mesh(point.height === 'low' ? lowPost : highPost, this.exposedMaterial);
      const tip = new THREE.Mesh(arrow, this.exposedMaterial);
      tip.position.set(0, postHeightM, -arrowLengthM / 2);
      post.add(tip);
      // In the marker's own space +x is the right-hand side when facing the cover.
      for (const sign of point.lean === 'left' ? [-1] : point.lean === 'right' ? [1] : point.lean === 'both' ? [1, -1] : []) {
        const bar = new THREE.Mesh(sideBar, this.sideMaterial);
        bar.position.set((sign * sideTickM.length) / 2, postHeightM, 0);
        post.add(bar);
      }
      post.position.set(point.xM, 0, point.zM);
      post.rotation.y = point.facingYawRad;
      this.posts.push(post);
      this.group.add(post);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  get shown(): boolean {
    return this.group.visible;
  }

  set shown(on: boolean) {
    this.group.visible = on;
    this.timerSec = 0; // colour it straight away
  }

  /** Once per screen frame. */
  update(dtSec: number): void {
    if (!this.group.visible) return;
    while (this.rings.length < this.standIns.length) {
      const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.rings.forEach((ring, i) => {
      const chosen = this.standIns[i]?.cover ?? null;
      ring.visible = chosen !== null;
      if (chosen) ring.position.set(chosen.xM, liftM, chosen.zM);
    });
    this.timerSec -= dtSec;
    if (this.timerSec > 0) return;
    this.timerSec = 1 / checksPerSec;
    this.cover.points.forEach((point, i) => {
      const material = this.cover.hides(point, this.eyes) ? this.hidesMaterial : this.exposedMaterial;
      const post = this.posts[i];
      post.material = material;
      (post.children[0] as THREE.Mesh).material = material;
    });
  }
}
