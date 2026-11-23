import { Vector3 } from 'three';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import type { GreyboxLevel } from './greybox';
import type { GlassPane } from './glass';
import type { Navigation } from './navigation';

// Turns shots and blasts into broken glass (5.4, level.md "Breakable glass"). Every bullet, Rook's or an enemy's, that flies
// through a whole pane counts as a hit on it (`shot:landed` carries the line it flew); a grenade blast shatters every pane
// in its radius. When a pane shatters, walking through it works (the collision drops it), the navigation mesh opens its
// gap if it stands on the floor, and `glass:broken` tells the effects, the sound and the noise service.
// shortcut: the line counted is from the muzzle (a shot from Rook's gun), not his eye, so a pane brushed at a grazing angle
// right beside the gun may count or miss by a hair; fine for a hit counter.
export class GlassSystem {
  private readonly point = new Vector3();
  private readonly direction = new Vector3();

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly level: Pick<GreyboxLevel, 'glass' | 'collision' | 'glassGeometry'>,
    private readonly navigation: Navigation,
  ) {
    events.on('shot:landed', ({ muzzle, end, shooter }) => {
      this.direction.subVectors(end, muzzle).normalize();
      for (const pane of this.level.glass.panes) {
        if (pane.broken || !this.level.glass.crossing(pane, muzzle, end, this.point)) continue;
        if (this.level.glass.hit(pane)) this.broke(pane, shooter);
        else this.events.emit('glass:cracked', { pane, position: this.point, hits: pane.hits });
      }
    });
    events.on('grenade:exploded', ({ position, radiusM }) => {
      for (const pane of this.level.glass.blast(position, radiusM)) {
        pane.bounds.clampPoint(position, this.point); // the edge of the pane nearest the blast
        this.direction.subVectors(pane.bounds.getCenter(new Vector3()), position).normalize(); // blown away from it
        this.broke(pane, 'blast');
      }
    });
  }

  /** Every pane whole again, for a new run (instant restart). */
  reset(): void {
    const broken = this.level.glass.panes.filter((pane) => pane.broken);
    this.level.glass.reset();
    this.level.collision.setGlass(this.level.glassGeometry());
    for (const pane of broken) this.navigation.closePane(pane.id);
  }

  private broke(pane: GlassPane, by: 'player' | 'enemy' | 'blast'): void {
    this.level.collision.setGlass(this.level.glassGeometry());
    this.navigation.openPane(pane.id);
    this.events.emit('glass:broken', { pane, position: this.point, direction: this.direction, by });
  }
}
