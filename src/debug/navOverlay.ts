import * as THREE from 'three';
import type { StandInEnemy } from '../enemies/standInEnemy';
import type { Navigation } from '../level/navigation';

const meshColour = 0x2fd06a;
const meshOpacity = 0.25;
const pathColour = 0xffe14a;
const liftM = 0.03; // above the floor and its grid, so they do not flicker
const maxPathPoints = 64; // a route in the test room has a handful

// Dev-only overlays for 4.2 (architecture.md, "debug overlays"): the navigation mesh as a see-through green tint over the
// walkable floor, and the stand-in's route ahead as a yellow line. Both start hidden; the dev panel ticks show them.
export class NavOverlay {
  private readonly mesh: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly linePositions = new Float32Array(maxPathPoints * 3);
  private readonly route: THREE.Vector3[] = [];

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
    scene.add(this.mesh, this.line);
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
  }

  /** Once per screen frame: redraws the route line while it is shown. */
  update(): void {
    if (!this.line.visible) return;
    const points = this.standIn.routeAhead(this.route);
    const count = Math.min(points.length, maxPathPoints);
    for (let i = 0; i < count; i++) this.linePositions.set([points[i].x, points[i].y + liftM, points[i].z], i * 3);
    this.line.geometry.setDrawRange(0, count);
    this.line.geometry.getAttribute('position').needsUpdate = true;
  }
}
