import { movementConfig } from '../config/movement';
import type { Surface } from '../data/greyboxRoom';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import type { Player } from './player';

// Watches the player and says what he did that makes a sound: a footstep every stride, the start of a slide, of a vault or
// a climb, and a landing. The sound and the noise service listen to those events. Once per game update, after the player
// has moved. No drawing or audio code here.
export class MovementReporter {
  private strideM = 0;
  private foot: 0 | 1 = 0;
  private lastX: number;
  private lastZ: number;
  private wasMantling = false;

  constructor(
    private readonly events: EventBus<WeaponEvents>,
    private readonly player: Player,
    /** What the player is standing on at a point (x, feet height, z). */
    private readonly surfaceAt: (x: number, y: number, z: number) => Surface,
  ) {
    this.lastX = player.position.x;
    this.lastZ = player.position.z;
  }

  /** Forget the stride and where the player was (after a restart puts him somewhere else). */
  reset(): void {
    this.strideM = 0;
    this.lastX = this.player.position.x;
    this.lastZ = this.player.position.z;
    this.wasMantling = false;
  }

  update(): void {
    const { position, stance, mantle, grounded } = this.player;
    const mantling = mantle.active;
    if (mantling && !this.wasMantling) this.events.emit('player:mantled', { kind: mantle.kind, position: position.clone() });
    this.wasMantling = mantling;
    if (stance.slideStarted) this.events.emit('player:slid', { surface: this.surface(), position: position.clone() });

    // A footstep each time the player has walked a stride on his feet (not in the air, climbing or sliding).
    if (grounded && !mantling && stance.stance !== 'sliding') {
      this.strideM += Math.hypot(position.x - this.lastX, position.z - this.lastZ);
      const kind = this.player.isSprinting ? 'sprint' : stance.stance === 'crouching' ? 'crouch' : 'walk';
      const everyM = kind === 'sprint' ? movementConfig.stepEverySprintM : kind === 'crouch' ? movementConfig.stepEveryCrouchM : movementConfig.stepEveryWalkM;
      if (this.strideM >= everyM) {
        this.strideM -= everyM;
        this.foot = this.foot === 0 ? 1 : 0;
        this.events.emit('player:step', { kind, surface: this.surface(), foot: this.foot, position: position.clone() });
      }
    } else {
      this.strideM = 0;
    }
    this.lastX = position.x;
    this.lastZ = position.z;
  }

  /** The player came down at `speedMps`. Landings too soft to hear are not reported. */
  landed(speedMps: number): void {
    if (speedMps < movementConfig.landMinSpeedMps) return;
    this.events.emit('player:landed', { speedMps, surface: this.surface(), position: this.player.position.clone() });
  }

  private surface(): Surface {
    const p = this.player.position;
    return this.surfaceAt(p.x, p.y, p.z);
  }
}
