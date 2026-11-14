// Camera tuning. Units are in the names.
export const viewConfig = {
  /** Vertical field of view when not aiming. Aiming narrows it (each gun's `aimFovDeg`). */
  baseFovDeg: 75,
  /** Field of view the weapon in hand is drawn with. Fixed, so the gun does not grow when the view zooms to aim. */
  viewmodelFovDeg: 60,
} as const;
