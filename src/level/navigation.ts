import { Vector3, type BufferGeometry } from 'three';
import { getNavMeshPositionsAndIndices, init, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { navigationConfig } from '../config/navigation';

/** Metres to whole grid cells, rounding up so the margin is never smaller than asked. */
/** A path that ends this close to its goal is good enough: the other height is not tried. */
const nearEnoughM = 0.5;
/** Recast puts the mesh one cell height above the real floor; heights going in and out of this class are real floor heights. */
const meshLiftM = navigationConfig.cellHeightM;

const cells = (metres: number, cellM: number): number => Math.ceil(metres / cellM);

// The navigation mesh (architecture.md, "Navigation"): the floor an enemy can walk on, kept clear of walls and props by its
// body's radius, built from the level's triangles when the game starts. It answers "a path from here to there" as a list of
// points. The work is done by recast-navigation (Recast builds the mesh, Detour finds paths), the same code Unity, Unreal
// and Godot use. No drawing code here; the dev overlay draws `triangles()`.
// The library treats a prop as hollow, so the floor sealed inside one taller than an enemy (the 1.9 m platform) becomes a
// patch of its own. Nothing can reach it, and a path aimed there stops at the nearest floor that can be reached, so it is harmless.
// shortcut: one mesh for the whole room, built once (a "solo" mesh). Glass that breaks open (phase 5) needs a tile cache,
// which rebuilds only the part that changed.
export class Navigation {
  private readonly searchBox = { x: navigationConfig.searchSidewaysM, y: navigationConfig.searchUpDownM, z: navigationConfig.searchSidewaysM };
  private readonly floorPoint = { x: 0, y: 0, z: 0 };

  /** `null` when the library could not start: then there is no mesh, and no path is ever found. */
  private constructor(
    private readonly navMesh: NavMesh | null,
    private readonly query: NavMeshQuery | null,
  ) {}

  /** A navigation with no mesh, for when the library fails to start: every path and floor query fails (decision 219). */
  static unavailable(): Navigation {
    return new Navigation(null, null);
  }

  /** Starts the library (once) and builds the mesh from `geometry`, which must include the floor. */
  static async create(geometry: BufferGeometry): Promise<Navigation> {
    await init(); // the library's WebAssembly must start first; later calls return at once
    const { cellSizeM: cs, cellHeightM: ch, agentRadiusM, agentHeightM, agentStepM, maxSlopeDeg } = navigationConfig;
    const positions = geometry.getAttribute('position').array;
    const indices = geometry.getIndex()?.array;
    if (!indices) throw new Error('The navigation geometry needs an index');
    const result = generateSoloNavMesh(positions, indices, {
      cs,
      ch,
      walkableRadius: cells(agentRadiusM, cs),
      walkableHeight: cells(agentHeightM, ch),
      walkableClimb: Math.floor(agentStepM / ch), // rounded down: never a step higher than asked
      walkableSlopeAngle: maxSlopeDeg,
    });
    if (!result.success) throw new Error(`Could not build the navigation mesh: ${result.error}`);
    return new Navigation(result.navMesh, new NavMeshQuery(result.navMesh));
  }

  /**
   * Finds a walkable path from `from` to `to` and writes its points into `out` (its length is set to the number of points;
   * the first is the start). If `to` is off the mesh (on a crate, inside a prop) the path ends at the nearest walkable floor
   * beside it. Returns false, with `out` emptied, if there is no path.
   */
  findPath(from: Vector3, to: Vector3, out: Vector3[]): boolean {
    out.length = 0;
    if (!this.query) return false;
    // The start is on the floor it stands on. The end is tried at its own height first (a stair, the upper level), then at
    // floor level (Rook on a crate: his own height is an unreachable patch). The path that ends nearer the end wins.
    let best: { x: number; y: number; z: number }[] | null = null;
    let bestM = Infinity;
    for (const toY of to.y === 0 ? [0] : [to.y, 0]) {
      const start = this.onFloor(from, from.y) ?? this.onFloor(from, 0);
      const end = this.onFloor(to, toY);
      if (!start || !end) continue;
      const { success, path } = this.query.computePath(start, end, { halfExtents: this.searchBox });
      if (!success || path.length === 0) continue;
      const last = path[path.length - 1];
      const endM = Math.hypot(last.x - to.x, last.z - to.z) + Math.abs(last.y - meshLiftM - to.y);
      if (endM < bestM) {
        best = path;
        bestM = endM;
      }
      if (endM < nearEnoughM) break;
    }
    if (!best) return false;
    for (const point of best) out.push(new Vector3(point.x, point.y - meshLiftM, point.z)); // a few times a second, so a little garbage is fine
    return true;
  }

  /** The walkable floor nearest to `position`, written into `out`. Returns false if there is none within reach. */
  closestPoint(position: Vector3, out: Vector3): boolean {
    const point = this.onFloor(position, position.y) ?? this.onFloor(position, 0);
    if (!point) return false;
    out.set(point.x, point.y - meshLiftM, point.z);
    return true;
  }

  /** The mesh's triangles, for the dev overlay: flat positions (x, y, z, ...) and indices. */
  triangles(): [positions: number[], indices: number[]] {
    return this.navMesh ? getNavMeshPositionsAndIndices(this.navMesh) : [[], []];
  }

  /** The nearest point of the mesh around `position`'s x and z at height `y`. Null if there is none within reach. */
  private onFloor(position: Vector3, y: number): { x: number; y: number; z: number } | null {
    if (!this.query) return null;
    this.floorPoint.x = position.x;
    this.floorPoint.y = y + meshLiftM;
    this.floorPoint.z = position.z;
    const { success, polyRef, point } = this.query.findClosestPoint(this.floorPoint, { halfExtents: this.searchBox });
    // Detour reports success with polygon 0 when nothing is within reach. The point is a new object each call.
    return success && polyRef !== 0 ? point : null;
  }
}
