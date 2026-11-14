// Navigation mesh settings (milestone 4.2, decision 204). The mesh is built once when the game starts, so these are not on
// the dev panel: change them here and reload. Starting values. Units are in the names.
export const navigationConfig = {
  /** Size of one grid cell across the floor. Smaller follows walls more closely but builds slower. */
  cellSizeM: 0.1,
  /** Size of one grid cell upward. */
  cellHeightM: 0.1,
  /** How far an enemy's body reaches from its centre: the mesh keeps this far from walls and props. The stand-in's capsule radius. */
  agentRadiusM: 0.3,
  /** Room an enemy needs overhead. It does not crouch, so the 1.3 m beam blocks it. */
  agentHeightM: 1.8,
  /** The highest step it walks up. Low enough that every prop is an obstacle: enemies do not climb or vault (gameplay.md). */
  agentStepM: 0.3,
  maxSlopeDeg: 45,
  /** How far around a point (sideways, and up or down) to look for the mesh when a point is off it, such as Rook on a crate. */
  searchSidewaysM: 2,
  searchUpDownM: 0.5,
} as const;
