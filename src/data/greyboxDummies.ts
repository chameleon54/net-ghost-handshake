// Where the test dummies stand in the grey-box room (feet position). The player starts at x 0, z 4.5 facing north (-z).
export const greyboxDummies = [
  { xM: 1.5, zM: 0.5 }, // in the open, about 4 m away
  { xM: -4, zM: -3.2 }, // just north of the low crate: stand south of the crate and it covers part of the dummy
  { xM: -6.5, zM: -4.5 }, // in the open, about 11 m away
] as const;
