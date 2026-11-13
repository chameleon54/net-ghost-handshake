import { Box3, BufferGeometry, Line3, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Static level collision: a BVH (a fast spatial index) over every wall and prop triangle.
// shortcut: the floor is not in here and the player only moves sideways. Add vertical collision in 1.5.
// shortcut: no continuous collision. To tunnel, the capsule would have to cross a wall's thickness plus its own width in one
// update (at least 0.8 m, about 48 m/s at 60 Hz). Safe for walking, sprinting and sliding (8 m/s); re-check if anything faster carries the player.
export class LevelCollision {
  private readonly bvh: MeshBVH;

  // Reused every call so nothing is allocated in the hot path.
  private readonly segment = new Line3();
  private readonly searchBox = new Box3();
  private readonly onTriangle = new Vector3();
  private readonly onSegment = new Vector3();
  private readonly push = new Vector3();
  private readonly triNormal = new Vector3();

  constructor(geometry: BufferGeometry) {
    this.bvh = new MeshBVH(geometry);
  }

  /**
   * Pushes a capsule (feet at `position`) out of the level, sideways only. Changes `position`.
   * Pushing along the surface is what makes the player slide along walls instead of stopping dead.
   */
  pushOut(position: Vector3, radiusM: number, heightM: number, iterations: number): void {
    const { segment, searchBox, onTriangle, onSegment, push, triNormal } = this;

    // The capsule's centre line runs between the centres of its two end spheres.
    segment.start.set(position.x, position.y + radiusM, position.z);
    segment.end.set(position.x, position.y + heightM - radiusM, position.z);

    for (let i = 0; i < iterations; i++) {
      searchBox.makeEmpty();
      searchBox.expandByPoint(segment.start);
      searchBox.expandByPoint(segment.end);
      searchBox.min.addScalar(-radiusM);
      searchBox.max.addScalar(radiusM);

      let pushed = false;
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(searchBox),
        intersectsTriangle: (triangle) => {
          const distanceM = triangle.closestPointToSegment(segment, onTriangle, onSegment);
          if (distanceM >= radiusM) return false; // false keeps searching the remaining triangles

          if (distanceM > 1e-6) {
            push.subVectors(onSegment, onTriangle);
          } else {
            // The centre line passes through the triangle itself, so there is no direction to use; take its face.
            triangle.getNormal(triNormal);
            push.copy(triNormal);
          }
          push.y = 0;
          if (push.lengthSq() < 1e-12) return false; // purely vertical: nothing to push sideways
          push.normalize().multiplyScalar(radiusM - distanceM);

          segment.start.add(push);
          segment.end.add(push);
          position.add(push);
          pushed = true;
          return false;
        },
      });

      if (!pushed) break;
    }
  }
}
