import { Box3, BufferGeometry, DoubleSide, Line3, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** What a push-out touched. Reused between calls, so read it straight away and do not keep it. */
export interface Contact {
  /** Pushed upward: standing on something. */
  up: boolean;
  /** Pushed downward: bumped a ceiling. */
  down: boolean;
}

/** Where a bullet ray hit. Reused between calls, so read it straight away and do not keep it. */
export interface RayHit {
  distanceM: number;
  point: Vector3;
  /** Unit vector pointing out of the surface, toward the shooter. */
  normal: Vector3;
}

export function createRayHit(): RayHit {
  return { distanceM: 0, point: new Vector3(), normal: new Vector3() };
}

// Static level collision: a BVH (a fast spatial index) over every wall and prop triangle.
// The floor is not in here; the player code treats height 0 as the floor.
// shortcut: no continuous collision. To get through a surface the capsule would have to move more than its own width (0.6 m)
// plus the surface's thickness in one update: 36 m/s at 60 Hz. Walking, sprinting, sliding (8 m/s) and the fall speed cap (30 m/s) stay below that.
// Re-check if anything faster ever carries the player.
export class LevelCollision {
  private readonly bvh: MeshBVH;
  /** Only the parts Space may climb, or null if there are none. */
  private readonly climbableBvh: MeshBVH | null;

  // Reused every call so nothing is allocated in the hot path.
  private readonly segment = new Line3();
  private readonly searchBox = new Box3();
  private readonly onTriangle = new Vector3();
  private readonly onSegment = new Vector3();
  private readonly push = new Vector3();
  private readonly triNormal = new Vector3();
  private readonly ray = new Ray();
  private readonly contact: Contact = { up: false, down: false };

  constructor(geometry: BufferGeometry, climbableGeometry: BufferGeometry | null = null) {
    this.bvh = new MeshBVH(geometry);
    this.climbableBvh = climbableGeometry ? new MeshBVH(climbableGeometry) : null;
  }

  /**
   * Distance from `origin` along the unit `direction` to the first wall or prop, or Infinity if none within `maxDistanceM`.
   * With `climbableOnly` only the parts Space may climb are considered.
   */
  rayDistance(origin: Vector3, direction: Vector3, maxDistanceM: number, climbableOnly = false): number {
    const bvh = climbableOnly ? this.climbableBvh : this.bvh;
    if (!bvh) return Infinity;
    this.ray.origin.copy(origin);
    this.ray.direction.copy(direction);
    const hit = bvh.raycastFirst(this.ray, DoubleSide, 0, maxDistanceM);
    return hit ? hit.distance : Infinity;
  }

  /**
   * A bullet ray: finds the first wall, prop or the floor within `maxDistanceM` and writes where into `out`.
   * Returns false (leaving `out` alone) if nothing was hit. `direction` must be a unit vector.
   */
  raycast(origin: Vector3, direction: Vector3, maxDistanceM: number, out: RayHit): boolean {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(direction);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, maxDistanceM);
    let found = false;
    if (hit) {
      out.distanceM = hit.distance;
      out.point.copy(hit.point);
      // A box face seen from outside has its normal toward the shooter; flip it if the ray came from behind.
      out.normal.copy(hit.face!.normal);
      if (out.normal.dot(direction) > 0) out.normal.negate();
      found = true;
    }
    // The floor is not in the BVH (see the class comment), so test the plane y = 0 here.
    if (direction.y < 0 && origin.y > 0) {
      const floorDistanceM = -origin.y / direction.y;
      if (floorDistanceM <= maxDistanceM && (!found || floorDistanceM < out.distanceM)) {
        out.distanceM = floorDistanceM;
        out.point.copy(direction).multiplyScalar(floorDistanceM).add(origin);
        out.normal.set(0, 1, 0);
        found = true;
      }
    }
    return found;
  }

  /**
   * True if a capsule (feet at `position`) overlaps the level by more than `toleranceM`. Moves nothing.
   * Used to ask "is there room here?", for standing up under a ceiling and for landing spots.
   */
  overlapsCapsule(position: Vector3, radiusM: number, heightM: number, toleranceM: number): boolean {
    const { segment, searchBox, onTriangle, onSegment } = this;
    segment.start.set(position.x, position.y + radiusM, position.z);
    segment.end.set(position.x, position.y + heightM - radiusM, position.z);
    searchBox.makeEmpty();
    searchBox.expandByPoint(segment.start);
    searchBox.expandByPoint(segment.end);
    searchBox.min.addScalar(-radiusM);
    searchBox.max.addScalar(radiusM);

    return this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(searchBox),
      // Returning true stops the search: one overlapping triangle is enough.
      intersectsTriangle: (triangle) => triangle.closestPointToSegment(segment, onTriangle, onSegment) < radiusM - toleranceM,
    });
  }

  /**
   * Pushes a capsule (feet at `position`) out of the level. Changes `position`.
   * Pushing along the surface is what makes the player slide along walls instead of stopping dead.
   * With `vertical` false the push is sideways only (used for the camera sphere); with it true the
   * capsule can also be pushed up (standing on something) or down (a ceiling), and the result says which.
   */
  pushOut(position: Vector3, radiusM: number, heightM: number, iterations: number, vertical = false): Contact {
    const { segment, searchBox, onTriangle, onSegment, push, triNormal, contact } = this;
    contact.up = false;
    contact.down = false;

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
          if (!vertical) push.y = 0;
          if (push.lengthSq() < 1e-12) return false; // nothing to push in the allowed directions
          push.normalize();
          if (push.y > 0.5) contact.up = true;
          else if (push.y < -0.5) contact.down = true;
          push.multiplyScalar(radiusM - distanceM);

          segment.start.add(push);
          segment.end.add(push);
          position.add(push);
          pushed = true;
          return false;
        },
      });

      if (!pushed) break;
    }
    return contact;
  }
}
