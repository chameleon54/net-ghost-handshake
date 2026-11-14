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
// walkable floor, and each stand-in's route ahead as a yellow line, with a cross where it last knew Rook was (decision
// 213): pink while fresh, grey once too old to fire at (decision 216). Both start hidden; the dev panel ticks show them.
interface RouteMarks {
  line: THREE.Line;
  positions: Float32Array;
  cross: THREE.Group;
  crossMaterial: THREE.MeshBasicMaterial;
}

export class NavOverlay {
  private readonly mesh: THREE.Mesh;
  private readonly marks: RouteMarks[] = [];
  private readonly route: THREE.Vector3[] = [];
  private routesShown = false;
  private readonly bar = new THREE.BoxGeometry(crossSizeM.length, crossSizeM.thickness, crossSizeM.thickness);

  constructor(
    private readonly scene: THREE.Scene,
    navigation: Navigation,
    /** The stand-ins in the room (the list may change). */
    private readonly standIns: readonly StandInEnemy[],
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
    scene.add(this.mesh);
  }

  /** A route line and a last-known cross for one more stand-in. */
  private addMarks(): void {
    const positions = new Float32Array(maxPathPoints * 3);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: pathColour, depthTest: false }));
    line.frustumCulled = false; // its points move, so its bounds would be stale
    const crossMaterial = new THREE.MeshBasicMaterial({ color: lastKnownColour });
    const cross = new THREE.Group();
    const barA = new THREE.Mesh(this.bar, crossMaterial);
    const barB = new THREE.Mesh(this.bar, crossMaterial);
    barA.rotation.y = Math.PI / 4;
    barB.rotation.y = -Math.PI / 4;
    cross.add(barA, barB);
    this.scene.add(line, cross);
    this.marks.push({ line, positions, cross, crossMaterial });
  }

  get meshShown(): boolean {
    return this.mesh.visible;
  }

  set meshShown(on: boolean) {
    this.mesh.visible = on;
  }

  get pathShown(): boolean {
    return this.routesShown;
  }

  set pathShown(on: boolean) {
    this.routesShown = on;
    if (on) return;
    for (const mark of this.marks) mark.line.visible = mark.cross.visible = false;
  }

  /** Once per screen frame: redraws the routes while they are shown. */
  update(): void {
    if (!this.routesShown) return;
    while (this.marks.length < this.standIns.length) this.addMarks();
    this.marks.forEach((mark, i) => {
      const standIn = this.standIns[i];
      mark.line.visible = standIn !== undefined;
      mark.cross.visible = standIn !== undefined && standIn.knowsWhere && standIn.awake;
      if (!standIn) return;
      mark.cross.position.set(standIn.lastKnown.x, liftM, standIn.lastKnown.z);
      mark.crossMaterial.color.setHex(standIn.knowsFresh ? lastKnownColour : staleColour);
      const points = standIn.routeAhead(this.route);
      const count = Math.min(points.length, maxPathPoints);
      for (let p = 0; p < count; p++) mark.positions.set([points[p].x, points[p].y + liftM, points[p].z], p * 3);
      mark.line.geometry.setDrawRange(0, count);
      mark.line.geometry.getAttribute('position').needsUpdate = true;
    });
  }
}
