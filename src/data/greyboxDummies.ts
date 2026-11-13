// Where the test dummies stand in the grey-box room (feet position) and which way they face (0 = north, -z; pi = south). The player starts at x 0, z 4.5 facing north (-z).
export const greyboxDummies = [
  { xM: 1.5, zM: 0.5, yawRad: Math.PI }, // in the open, about 4 m away, facing the start
  { xM: -4, zM: -3.2, yawRad: 0 }, // just north of the low crate, facing away from the start: try a knife from behind
  { xM: -6.5, zM: -4.5, yawRad: Math.PI }, // in the open, about 11 m away, facing the start
] as const;
