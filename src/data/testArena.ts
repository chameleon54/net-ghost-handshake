import type { Role } from '../config/roles';
import type { FloorZone, HazardPad, RoomBox, RoomLayout } from './greyboxRoom';

// A larger grey-box arena for testing squad tactics (decision 236), 30 m (x) by 24 m (z), centred on 0,0. It follows the
// central chamber rules in level.md (looping routes and no dead ends, low and high cover mixed, gaps of about a sprint
// between pieces, room for a squad to spread out), but it is NOT the central chamber: layout.md says no room is built
// before its design pass (pass 3, milestone 5.1). Phase 5 replaces it. Rook starts in the south, the squad in the north.
// Heights follow the bands in level.md: low cover 1.0 m, climbable 1.5 to 1.9 m, high cover and walls above 2 m.
// Its cover points are generated from the props (coverPointsFromBoxes in src/level/cover.ts).

export const testArenaLayout: RoomLayout = {
  size: { widthM: 30, depthM: 24 },
  /** Footstep surfaces: a tile patch by the start, a metal one in the north-east. Elsewhere concrete. */
  floors: [
    { xM: -9, zM: 9, widthM: 4, depthM: 3, surface: 'tile' },
    { xM: 9, zM: -9.5, widthM: 4, depthM: 3, surface: 'metal' },
  ] satisfies FloorZone[],
  /** The test hazard pad, out of the way in the north-east corner. */
  hazards: [{ xM: 12.5, zM: -10.5, widthM: 2, depthM: 2 }] satisfies HazardPad[],
};

const bench = (xM: number, zM: number, widthM = 3): RoomBox => ({ kind: 'prop', xM, zM, widthM, depthM: 0.8, heightM: 1 });
const crate = (xM: number, zM: number, sizeM = 1.2, heightM = 1): RoomBox => ({ kind: 'prop', xM, zM, widthM: sizeM, depthM: sizeM, heightM });
const rack = (xM: number, zM: number): RoomBox => ({ kind: 'prop', xM, zM, widthM: 0.8, depthM: 3, heightM: 2.4 }); // server rack
const pillar = (xM: number, zM: number): RoomBox => ({ kind: 'prop', xM, zM, widthM: 0.8, depthM: 0.8, heightM: 3 });
const tank = (xM: number, zM: number): RoomBox => ({ kind: 'prop', xM, zM, widthM: 1.6, depthM: 1.6, heightM: 2.2 });

export const testArena: readonly RoomBox[] = [
  // Outer walls, 0.3 m thick and 3 m tall, just outside the interior.
  { kind: 'wall', xM: 0, zM: -12.15, widthM: 30.6, depthM: 0.3, heightM: 3 },
  { kind: 'wall', xM: 0, zM: 12.15, widthM: 30.6, depthM: 0.3, heightM: 3 },
  { kind: 'wall', xM: -15.15, zM: 0, widthM: 0.3, depthM: 24, heightM: 3 },
  { kind: 'wall', xM: 15.15, zM: 0, widthM: 0.3, depthM: 24, heightM: 3 },

  // South: Rook's side.
  bench(-6, 6),
  bench(6, 6),
  crate(0, 7.5),
  rack(-11, 5),
  rack(11, 5),
  crate(-2.5, 9.5, 1.5, 1.5), // climbable
  { kind: 'prop', xM: 12, zM: 9.5, widthM: 3, depthM: 2.5, heightM: 1.9 }, // a raised corner to climb onto (height variation)

  // The middle: pillars, tanks, benches and crates, every piece open on all sides so routes loop.
  pillar(-3.5, 0),
  pillar(3.5, 0),
  tank(-9, -1),
  tank(9, -1),
  bench(0, 3, 4),
  crate(-6, 2, 1.5, 1.5), // climbable
  crate(6, -2.5, 1.5, 1.5), // climbable
  bench(0, -3, 4),

  // North: the squad's side.
  bench(-6, -6.5),
  bench(6, -6.5),
  rack(-11, -6),
  rack(11, -6),
  crate(0, -8),
  { kind: 'prop', xM: -3.5, zM: -10, widthM: 3, depthM: 0.3, heightM: 2.4 }, // partitions the squad comes in between
  { kind: 'prop', xM: 3.5, zM: -10, widthM: 3, depthM: 0.3, heightM: 2.4 },
];

/** Where Rook starts (and restarts): south, facing north. */
export const testArenaStart = { xM: 0, zM: 10.5, yawRad: 0 } as const;

/** Target dummies, facing the start. */
export const testArenaDummies = [
  { xM: 3, zM: 9, yawRad: Math.PI }, // in the open, about 3 m away
  { xM: -8, zM: 3.5, yawRad: Math.PI }, // beside the crates, about 10 m away
  { xM: 8, zM: 8.5, yawRad: Math.PI }, // by the east bench
] as const;

/** The squad's spawns: one of each role, spread over the north and the east, facing the start. */
export const testArenaStandIns: readonly { readonly xM: number; readonly zM: number; readonly yawRad: number; readonly role: Role }[] = [
  { xM: 0, zM: -10.8, yawRad: Math.PI, role: 'leader' }, // A: between the partitions
  { xM: -9, zM: -10.5, yawRad: Math.PI, role: 'trooper' }, // B: north-west
  { xM: 9, zM: -10.5, yawRad: Math.PI, role: 'flanker' }, // C: north-east
  { xM: 13, zM: -2.5, yawRad: Math.PI * 0.75, role: 'heavy' }, // D: the east side
];
