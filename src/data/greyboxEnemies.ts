import type { Role } from '../config/roles';

// Where the stand-in enemies start in the grey-box room: feet position, facing (0 = north, -z; pi = south) and role. Since
// 4.6 there are four (A to D, a squad), spread over the north half and the east side, each about 8 to 11 m from the
// player's start (x 0, z 4.5) and facing it; since 4.8 one of each role. The dev panel's "Stand-ins in the room" uses the
// first ones in this list.
export const greyboxStandIns: readonly { readonly xM: number; readonly zM: number; readonly yawRad: number; readonly role: Role }[] = [
  { xM: 1.5, zM: -5, yawRad: Math.PI, role: 'leader' }, // A: between the tall crate and the platform (the 4.1 spot)
  { xM: -5, zM: -5.3, yawRad: Math.PI, role: 'trooper' }, // B: north-west corner, behind the low crate
  { xM: 5, zM: -5.3, yawRad: Math.PI, role: 'flanker' }, // C: north-east, past the tall crate
  { xM: 6.5, zM: -0.5, yawRad: Math.PI * 0.7, role: 'heavy' }, // D: east side, north of the short wall
];
