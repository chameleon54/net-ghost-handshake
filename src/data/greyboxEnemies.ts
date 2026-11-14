// Where the stand-in enemies start in the grey-box room: feet position and facing (0 = north, -z; pi = south). Since 4.6
// there are four (A to D, a squad), spread over the north half and the east side, each about 8 to 11 m from the player's
// start (x 0, z 4.5) and facing it. The dev panel's "Stand-ins in the room" uses the first ones in this list.
export const greyboxStandIns = [
  { xM: 1.5, zM: -5, yawRad: Math.PI }, // A: between the tall crate and the platform (the 4.1 spot)
  { xM: -5, zM: -5.3, yawRad: Math.PI }, // B: north-west corner, behind the low crate
  { xM: 5, zM: -5.3, yawRad: Math.PI }, // C: north-east, past the tall crate
  { xM: 6.5, zM: -0.5, yawRad: Math.PI * 0.7 }, // D: east side, north of the short wall
] as const;
