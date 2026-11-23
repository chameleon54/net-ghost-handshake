import { Box3, Ray, Vector3 } from 'three';
import { glassConfig } from '../config/glass';
import type { RoomBox } from '../data/greyboxRoom';

/** One pane of breakable glass: a box of the level with `glass: true`. It is whole until it has taken `hitsToBreak` hits. */
export interface GlassPane {
  readonly id: string;
  readonly box: RoomBox;
  readonly bounds: Box3;
  hits: number;
  broken: boolean;
}

/** A pane that stands on the floor: when it breaks it leaves a gap to walk through. A raised one (a parapet) never does. */
export const standsOnFloor = (pane: GlassPane): boolean => (pane.box.yM ?? 0) === 0;

// The glass of a level and how much each pane has taken (level.md, "Breakable glass"). Plain rules, no drawing and no events:
// `GlassSystem` (glassSystem.ts) feeds it shots and blasts and tells the rest of the game. Panes are few, so every query is a loop.
// Rules (decision 283): bullets pass through intact glass, each one counting as a hit; the last hit shatters the pane; a blast
// shatters every pane in its radius at once; a broken pane stays broken until `reset` (a new run).
export class GlassPanes {
  readonly panes: GlassPane[];
  private readonly ray = new Ray();
  private readonly delta = new Vector3();
  private readonly entry = new Vector3();

  /** Takes the level's boxes and keeps the solid glass ones. A box without an id (the old test room) is named by its place in the list. */
  constructor(boxes: readonly RoomBox[]) {
    this.panes = [];
    boxes.forEach((box, index) => {
      if (!box.glass || box.solid === false) return;
      const bottomM = box.yM ?? 0;
      const bounds = new Box3(new Vector3(box.xM - box.widthM / 2, bottomM, box.zM - box.depthM / 2), new Vector3(box.xM + box.widthM / 2, bottomM + box.heightM, box.zM + box.depthM / 2));
      this.panes.push({ id: (box as { id?: string }).id ?? `glass-${index}`, box, bounds, hits: 0, broken: false });
    });
  }

  anyIntact(): boolean {
    return this.panes.some((pane) => !pane.broken);
  }

  /** The boxes of the panes still whole: what blocks walking. */
  intactBoxes(): RoomBox[] {
    return this.panes.filter((pane) => !pane.broken).map((pane) => pane.box);
  }

  /** Where the line from `from` to `to` enters `pane`, written into `out`; false if it does not reach it. */
  crossing(pane: GlassPane, from: Vector3, to: Vector3, out: Vector3): boolean {
    const lengthM = this.delta.subVectors(to, from).length();
    if (lengthM < 1e-6) return false;
    this.ray.origin.copy(from);
    this.ray.direction.copy(this.delta).divideScalar(lengthM);
    if (!this.ray.intersectBox(pane.bounds, this.entry) || from.distanceTo(this.entry) > lengthM) return false;
    out.copy(this.entry);
    return true;
  }

  /** True if a whole pane is in the way of the line from `from` to `to`. */
  intactOnSegment(from: Vector3, to: Vector3): boolean {
    return this.panes.some((pane) => !pane.broken && this.crossing(pane, from, to, this.entry));
  }

  /** Counts one hit on a pane; true if that was the one that shattered it. */
  hit(pane: GlassPane): boolean {
    if (pane.broken) return false;
    pane.hits++;
    pane.broken = pane.hits >= glassConfig.hitsToBreak;
    return pane.broken;
  }

  /** Shatters every whole pane whose box is within `radiusM` of `position`. Returns the ones it broke. */
  blast(position: Vector3, radiusM: number): GlassPane[] {
    const broken = this.panes.filter((pane) => !pane.broken && pane.bounds.distanceToPoint(position) <= radiusM);
    for (const pane of broken) pane.broken = true;
    return broken;
  }

  /** Every pane whole again, for a new run. */
  reset(): void {
    for (const pane of this.panes) {
      pane.hits = 0;
      pane.broken = false;
    }
  }
}
