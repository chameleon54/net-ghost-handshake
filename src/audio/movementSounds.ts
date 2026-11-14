import { healthConfig } from '../config/health';
import { landingLoudness, movementConfig } from '../config/movement';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import type { SoundName } from './recipes';
import type { SoundPlayer } from './soundPlayer';
import type { Rng } from './synth';

const stepSounds = { concrete: 'step-concrete', metal: 'step-metal', tile: 'step-tile' } as const satisfies Record<string, SoundName>;
const pitchVariationShare = 0.02; // a little random on top of the left and right foot difference

// Decides which sound plays for each movement event: the footstep for the surface, quieter crouched and louder sprinting,
// the slide, the vault, the climb and a landing (soft or heavy by how hard it was). Each sound is placed at the player's
// feet. Plain logic with no browser code: it talks to a SoundPlayer.
export class MovementSounds {
  constructor(
    events: EventBus<WeaponEvents>,
    private readonly player: SoundPlayer,
    private readonly random: Rng = Math.random,
  ) {
    events.on('player:step', ({ kind, surface, foot, position }) => {
      const volume = kind === 'sprint' ? movementConfig.stepVolumeSprint : kind === 'crouch' ? movementConfig.stepVolumeCrouch : movementConfig.stepVolumeWalk;
      const footPitch = (foot === 0 ? -1 : 1) * movementConfig.footPitchShare;
      this.player.play(stepSounds[surface], { position, volume, rate: 1 + footPitch + this.jitter(), note: `${kind}, ${foot === 0 ? 'left' : 'right'} foot, ${surface}` });
    });
    events.on('player:slid', ({ surface, position }) =>
      this.player.play('slide', { position, volume: movementConfig.slideVolume, rate: 1 + this.jitter(), note: `slide on ${surface}` }),
    );
    events.on('player:mantled', ({ kind, position }) =>
      this.player.play(kind, { position, volume: kind === 'vault' ? movementConfig.vaultVolume : movementConfig.climbVolume, rate: 1 + this.jitter(), note: kind }),
    );
    events.on('player:landed', ({ speedMps, surface, position }) => {
      const hard = speedMps >= healthConfig.fallSafeSpeedMps; // from here a landing also hurts
      const volume = hard ? 1 : movementConfig.landSoftMinVolume + (1 - movementConfig.landSoftMinVolume) * landingLoudness(speedMps);
      this.player.play(hard ? 'land-hard' : 'land-soft', { position, volume, rate: 1 + this.jitter(), note: `landed at ${speedMps.toFixed(1)} m/s on ${surface}` });
    });
  }

  private jitter(): number {
    return (this.random() * 2 - 1) * pitchVariationShare;
  }
}
