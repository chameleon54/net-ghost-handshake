// The grey-box test room as a list of boxes. Milestone 5.2 replaces this with the real level data format.
// Interior is 16 m (x) by 12 m (z), centred on 0,0. Heights follow the bands in level.md:
// low cover about 1.0 m, climbable 1.1-2.0 m, wall above 2.0 m.

export interface RoomBox {
  kind: 'wall' | 'prop' | 'marker';
  /** Centre of the box on the floor. */
  xM: number;
  zM: number;
  /** Whether Space can climb or vault it. Leave out for the default: props yes, walls no (so nobody climbs out of the room). */
  climbable?: boolean;
  /** Height of the box's bottom above the floor. Leave out for a box standing on the floor. */
  yM?: number;
  widthM: number; // size along x
  depthM: number; // size along z
  heightM: number;
}

export function isClimbable(box: RoomBox): boolean {
  return box.climbable ?? box.kind !== 'wall';
}

export const greyboxRoomSize = { widthM: 16, depthM: 12 } as const;

export const greyboxRoom: readonly RoomBox[] = [
  // Outer walls, 0.3 m thick and 3 m tall, just outside the interior.
  { kind: 'wall', xM: 0, zM: -6.15, widthM: 16.6, depthM: 0.3, heightM: 3 },
  { kind: 'wall', xM: 0, zM: 6.15, widthM: 16.6, depthM: 0.3, heightM: 3 },
  { kind: 'wall', xM: -8.15, zM: 0, widthM: 0.3, depthM: 12, heightM: 3 },
  { kind: 'wall', xM: 8.15, zM: 0, widthM: 0.3, depthM: 12, heightM: 3 },

  // Props.
  { kind: 'prop', xM: -4, zM: -2, widthM: 1, depthM: 1, heightM: 1.0 }, // low crate
  { kind: 'prop', xM: 3, zM: -3, widthM: 1.2, depthM: 1.2, heightM: 1.5 }, // tall crate
  { kind: 'prop', xM: 0, zM: 0, widthM: 0.6, depthM: 0.6, heightM: 2.2 }, // pillar
  { kind: 'prop', xM: -2.5, zM: 3, widthM: 3, depthM: 0.6, heightM: 1.0 }, // long bench

  // L-shaped wall for testing corners. Its inside corner is near x 6.3, z 2.1.
  { kind: 'prop', xM: 5, zM: 2, widthM: 3, depthM: 0.2, heightM: 2.5 },
  { kind: 'prop', xM: 6.4, zM: 3.5, widthM: 0.2, depthM: 3, heightM: 2.5 },

  // Peek corner for testing the lean: stand south of the partition near x -6.2, z 3.0, facing north. The orange
  // marker just past the partition's end is hidden until you lean right. tests/lean.test.ts checks this.
  { kind: 'prop', xM: -6.75, zM: 1.5, widthM: 2.5, depthM: 0.3, heightM: 2.4 },
  { kind: 'marker', xM: -4.9, zM: -0.5, widthM: 0.5, depthM: 0.5, heightM: 1.0 },

  // For climbing: a 1.9 m platform (the highest ledge that can be climbed, limit 2.0 m)
  // and a low beam over a corridor, 1.3 m up: you fit under it crouched (1.2 m) but not standing (1.8 m).
  { kind: 'prop', xM: -2, zM: -4, widthM: 2, depthM: 2, heightM: 1.9 }, // leaves a 1 m walkway behind it; a gap narrower than the player would trap them
  { kind: 'prop', xM: 6.2, zM: -3.5, yM: 1.3, widthM: 3, depthM: 2, heightM: 0.8 },
];
