import * as THREE from 'three';
import type { StandInEnemy } from '../enemies/standInEnemy';
import type { Navigation } from '../level/navigation';

const meshColour = 0x2fd06a;
const meshOpacity = 0.25;
const pathColour = 0xffe14a;
const liftM = 0.03; // above the floor and its grid, so they do not flicker
const maxPathPoints = 64; // a route in the test room has a handful
const lastKnownColour = 0xff5ad1;
const staleColour = 0x808080; // what it knows is too old to fire at (decision 216)
const crossSizeM = { length: 0.6, thickness: 0.06 } as const;

// Dev-only overlays for 4.2 (architecture.md, "debug overlays"): the navigation mesh as a see-through green tint over the
// walkable floor, and the stand-in's route ahead as a yellow line, with a cross where it last knew Rook was (decision 213):
// pink while fresh, grey once too old to fire at (decision 216). Both start hidden; the dev panel ticks show them.
export class NavOverlay {
  private readonly mesh: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly linePositions = new Float32Array(maxPathPoints * 3);
  private readonly route: THREE.Vector3[] = [];
  private readonly lastKnownCross = new THREE.Group();
  private readonly crossMaterial = new THREE.MeshBasicMaterial({ color: lastKnownColour });

  constructor(
    scene: THREE.Scene,
    navigation: Navigation,
    private readonly standIn: StandInEnemy,
  ) {
    const [positions, indices] = navigation.triangles();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: meshColour, transparent: true, opacity: meshOpacity, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.position.y = liftM;
    this.mesh.visible = false;

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: pathColour, depthTest: false }));
    this.line.frustumCulled = false; // its points move, so its bounds would be stale
    this.line.visible = false;
    const bar = new THREE.BoxGeometry(crossSizeM.length, crossSizeM.thickness, crossSizeM.thickness);
    const barA = new THREE.Mesh(bar, this.crossMaterial);
    const barB = new THREE.Mesh(bar, this.crossMaterial);
    barA.rotation.y = Math.PI / 4;
    barB.rotation.y = -Math.PI / 4;
    this.lastKnownCross.add(barA, barB);
    this.lastKnownCross.visible = false;
    scene.add(this.mesh, this.line, this.lastKnownCross);
  }

  get meshShown(): boolean {
    return this.mesh.visible;
  }

  set meshShown(on: boolean) {
    this.mesh.visible = on;
  }

  get pathShown(): boolean {
    return this.line.visible;
  }

  set pathShown(on: boolean) {
    this.line.visible = on;
    if (!on) this.lastKnownCross.visible = false;
  }

  /** Once per screen frame: redraws the route line while it is shown. */
  update(): void {
    if (!this.line.visible) return;
    this.lastKnownCross.visible = this.standIn.knowsWhere && this.standIn.awake;
    this.lastKnownCross.position.set(this.standIn.lastKnown.x, liftM, this.standIn.lastKnown.z);
    this.crossMaterial.color.setHex(this.standIn.knowsFresh ? lastKnownColour : staleColour);
    const points = this.standIn.routeAhead(this.route);
    const count = Math.min(points.length, maxPathPoints);
    for (let i = 0; i < count; i++) this.linePositions.set([points[i].x, points[i].y + liftM, points[i].z], i * 3);
    this.line.geometry.setDrawRange(0, count);
    this.line.geometry.getAttribute('position').needsUpdate = true;
  }
}
