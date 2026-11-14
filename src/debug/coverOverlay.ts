import * as THREE from 'three';
import type { StandInEnemy } from '../enemies/standInEnemy';
import type { CoverPoints } from '../level/cover';

const hidesColour = 0x2fd06a;
const exposedColour = 0xe0453a;
const chosenColour = 0xffe14a;
const postRadiusM = 0.05;
const lowPostM = 0.5;
const highPostM = 1.2;
const arrowLengthM = 0.25;
const arrowRadiusM = 0.08;
const ringInnerM = 0.3;
const ringOuterM = 0.38;
const liftM = 0.03; // above the floor and its grid, so the ring does not flicker
const checksPerSec = 5; // the "hides from you" colours are rays, so they are not redone every frame

// Dev-only overlay for 4.3 (architecture.md, "debug overlays"): a post at each cover point, short for low cover and tall for
// high, with an arrow toward the cover. Green: it hides a body from you right now. Red: it does not. A yellow ring marks
// the spot the stand-in has chosen. Hidden until the dev panel tick shows it.
export class CoverOverlay {
  private readonly group = new THREE.Group();
  private readonly posts: THREE.Mesh[] = [];
  private readonly ring: THREE.Mesh;
  private readonly hidesMaterial = new THREE.MeshBasicMaterial({ color: hidesColour });
  private readonly exposedMaterial = new THREE.MeshBasicMaterial({ color: exposedColour });
  private timerSec = 0;

  constructor(
    scene: THREE.Scene,
    private readonly cover: CoverPoints,
    private readonly standIn: StandInEnemy,
    /** Your eyes (the camera). */
    private readonly eyes: THREE.Vector3,
  ) {
    const lowPost = new THREE.CylinderGeometry(postRadiusM, postRadiusM, lowPostM).translate(0, lowPostM / 2, 0);
    const highPost = new THREE.CylinderGeometry(postRadiusM, postRadiusM, highPostM).translate(0, highPostM / 2, 0);
    // The arrow points along -z in its own space (yaw 0 = north), so turning the marker by the spot's yaw aims it at the cover.
    const arrow = new THREE.ConeGeometry(arrowRadiusM, arrowLengthM).rotateX(-Math.PI / 2);
    for (const point of cover.points) {
      const postHeightM = point.height === 'low' ? lowPostM : highPostM;
      const post = new THREE.Mesh(point.height === 'low' ? lowPost : highPost, this.exposedMaterial);
      const tip = new THREE.Mesh(arrow, this.exposedMaterial);
      tip.position.set(0, postHeightM, -arrowLengthM / 2);
      post.add(tip);
      post.position.set(point.xM, 0, point.zM);
      post.rotation.y = point.facingYawRad;
      this.posts.push(post);
      this.group.add(post);
    }
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInnerM, ringOuterM, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: chosenColour, side: THREE.DoubleSide }),
    );
    this.ring.position.y = liftM;
    this.group.add(this.ring);
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
    const chosen = this.standIn.cover;
    this.ring.visible = chosen !== null;
    if (chosen) this.ring.position.set(chosen.xM, liftM, chosen.zM);
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
