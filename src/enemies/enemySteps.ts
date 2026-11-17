import { Vector3 } from 'three';
import type { Role } from '../config/roles';
import { enemySoundConfig } from '../config/enemySounds';
import type { Surface } from '../data/greyboxRoom';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import type { StandInState } from './standInEnemy';

/** What the step counter needs to know of an enemy. */
export interface Walker {
  readonly xM: number;
  readonly zM: number;
  readonly role: Role;
  readonly state: StandInState;
  readonly crouched: boolean;
}

/** One enemy's walking so far. */
interface Track {
  xM: number;
  zM: number;
  sinceStepM: number;
  foot: 0 | 1;
}

/** Moving further than this in one update is a jump (a respawn), not walking. */
const jumpM = 1;

// Enemy footsteps (4.14, decision 264): once per game update, it measures how far each enemy in the room has moved on the
// ground, and each time that adds up to a stride it announces `enemy:step`: where, on what, which foot, and the gait
// (walking, running or moving crouched, from its speed). Nothing while it stands, falls or lies down. Timed by distance
// until enemy animation (7b) gives a walk cycle. Plain game logic: the sound listens to the event.
export class EnemySteps {
  private readonly tracks = new Map<Walker, Track>();
  private readonly at = new Vector3();

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    /** The surface under feet at (x, y, z). */
    private readonly surfaceAt: (x: number, y: number, z: number) => Surface,
  ) {}

  update(dtSec: number, walkers: readonly Walker[]): void {
    for (const walker of walkers) {
      const track = this.tracks.get(walker);
      if (!track) {
        this.tracks.set(walker, { xM: walker.xM, zM: walker.zM, sinceStepM: 0, foot: 0 });
        continue;
      }
      const movedM = Math.hypot(walker.xM - track.xM, walker.zM - track.zM);
      track.xM = walker.xM;
      track.zM = walker.zM;
      if (walker.state === 'falling' || walker.state === 'down' || movedM > jumpM || dtSec <= 0) {
        track.sinceStepM = 0; // no steps while falling or down, and a jump starts over
        continue;
      }
      if (movedM === 0) continue;
      const gait = walker.crouched ? 'crouch' : movedM / dtSec >= enemySoundConfig.runFromSpeedMps ? 'run' : 'walk';
      const strideM = gait === 'crouch' ? enemySoundConfig.strideCrouchM : gait === 'run' ? enemySoundConfig.strideRunM : enemySoundConfig.strideWalkM;
      track.sinceStepM += movedM;
      if (track.sinceStepM < strideM) continue;
      track.sinceStepM %= strideM; // at most one step per update; the rest carries over
      this.at.set(walker.xM, 0, walker.zM);
      this.events.emit('enemy:step', { position: this.at, surface: this.surfaceAt(walker.xM, 0, walker.zM), foot: track.foot, role: walker.role, gait });
      track.foot = track.foot === 0 ? 1 : 0;
    }
  }
}
