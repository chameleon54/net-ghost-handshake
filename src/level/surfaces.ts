import { greyboxFloors, greyboxRoom, type FloorZone, type RoomBox, type Surface } from '../data/greyboxRoom';

const topReachM = 0.1; // feet this close to a prop's top are standing on it
const floorHeightM = 0.05; // feet lower than this are on the floor

/** What a player with his feet at (x, y, z) is standing on: the top of a prop, or the floor patch under him (concrete if none). */
export function surfaceAt(
  x: number,
  y: number,
  z: number,
  boxes: readonly RoomBox[] = greyboxRoom,
  floors: readonly FloorZone[] = greyboxFloors,
): Surface {
  if (y > floorHeightM) {
    const box = boxes.find(
      (b) => Math.abs(x - b.xM) <= b.widthM / 2 && Math.abs(z - b.zM) <= b.depthM / 2 && Math.abs((b.yM ?? 0) + b.heightM - y) <= topReachM,
    );
    if (box) return box.surface ?? (box.kind === 'wall' ? 'concrete' : 'metal');
    return 'metal'; // up in the air or on something unknown: a hard surface
  }
  const zone = floors.find((f) => Math.abs(x - f.xM) <= f.widthM / 2 && Math.abs(z - f.zM) <= f.depthM / 2);
  return zone ? zone.surface : 'concrete';
}
