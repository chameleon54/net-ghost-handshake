// The shape of a level box that may be turned (milestone 5.5a, decision 286). A box is centred on (xM, zM), sized widthM
// (its own x) by depthM (its own z) by heightM, standing on yM, and turned yawDeg about its centre: degrees, positive
// turns left as seen from above, as the markers and Rook's yaw (three.js's rotation.y). Left out, 0: square to the walls.
// Everything that asks "is this point in the box" or "where does this ray meet it" comes here, so every system agrees
// with where the box is drawn and where it collides. Plain maths, no drawing.

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What these functions need of a box. */
export interface TurnedBox {
  xM: number;
  zM: number;
  yM?: number;
  widthM: number;
  depthM: number;
  heightM: number;
  yawDeg?: number;
}

export const yawRadOf = (box: TurnedBox): number => ((box.yawDeg ?? 0) * Math.PI) / 180;

/** A world direction on the floor (x, z) in the box's own axes. */
export function dirToLocal(box: TurnedBox, x: number, z: number): { x: number; z: number } {
  const yaw = yawRadOf(box);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x * c - z * s, z: x * s + z * c };
}

/** A direction in the box's own axes, in the world. Its own -z (its "north") turns with it, as a facing does. */
export function dirToWorld(box: TurnedBox, x: number, z: number): { x: number; z: number } {
  const yaw = yawRadOf(box);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** A world point on the floor (x, z), measured from the box's centre in its own axes. */
export function toLocal(box: TurnedBox, x: number, z: number): { x: number; z: number } {
  return dirToLocal(box, x - box.xM, z - box.zM);
}

/** A point in the box's own axes (from its centre), in the world. */
export function toWorld(box: TurnedBox, x: number, z: number): { x: number; z: number } {
  const d = dirToWorld(box, x, z);
  return { x: box.xM + d.x, z: box.zM + d.z };
}

/** True if (x, z) is over the box's footprint, grown by `marginM` on every side. */
export function overFootprint(box: TurnedBox, x: number, z: number, marginM = 0): boolean {
  const p = toLocal(box, x, z);
  return Math.abs(p.x) <= box.widthM / 2 + marginM && Math.abs(p.z) <= box.depthM / 2 + marginM;
}

/** How far (x, y, z) is from the box: 0 inside it. */
export function distanceToBoxM(box: TurnedBox, x: number, y: number, z: number): number {
  const p = toLocal(box, x, z);
  const dx = Math.max(Math.abs(p.x) - box.widthM / 2, 0);
  const dz = Math.max(Math.abs(p.z) - box.depthM / 2, 0);
  const bottom = box.yM ?? 0;
  const dy = y < bottom ? bottom - y : y > bottom + box.heightM ? y - bottom - box.heightM : 0;
  return Math.hypot(dx, dy, dz);
}

/** The square box around a turned one (what it covers on the world's axes). */
export function worldBounds(box: TurnedBox): { min: Vec3; max: Vec3 } {
  const yaw = yawRadOf(box);
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const halfX = (c * box.widthM + s * box.depthM) / 2;
  const halfZ = (s * box.widthM + c * box.depthM) / 2;
  const bottom = box.yM ?? 0;
  return { min: { x: box.xM - halfX, y: bottom, z: box.zM - halfZ }, max: { x: box.xM + halfX, y: bottom + box.heightM, z: box.zM + halfZ } };
}

/** Distance along the ray (unit `dir`) to an axis-aligned box, or Infinity if it misses. The slab method. */
export function rayBoxM(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): number {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis] || o > max[axis]) return Infinity; // parallel to this slab and outside it
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return Infinity;
  }
  if (far < 0) return Infinity; // behind the eye
  return Math.max(near, 0);
}

/** Distance along the ray (unit `dir`) to a turned box, or Infinity if it misses: the ray is turned into the box's own axes. */
export function rayTurnedBoxM(origin: Vec3, dir: Vec3, box: TurnedBox): number {
  const o = toLocal(box, origin.x, origin.z);
  const d = dirToLocal(box, dir.x, dir.z);
  const bottom = box.yM ?? 0;
  return rayBoxM({ x: o.x, y: origin.y, z: o.z }, { x: d.x, y: dir.y, z: d.z }, { x: -box.widthM / 2, y: bottom, z: -box.depthM / 2 }, { x: box.widthM / 2, y: bottom + box.heightM, z: box.depthM / 2 });
}

/** An angle in degrees brought into 0 to 360 (and to a tenth, as the file keeps it); 0 means square, so it may be left out. */
export function normalYawDeg(deg: number): number {
  const tenth = Math.round(deg * 10) / 10;
  return ((tenth % 360) + 360) % 360;
}
