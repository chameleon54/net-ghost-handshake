import type { HealthFeelState } from '../player/healthFeel';
import type { SoundPlayer } from './soundPlayer';

// Plays the heartbeat and the heavy breathing when the health feel says a beat or a breath is due. Plain logic with no
// browser code: it talks to a SoundPlayer. It runs on game time, so it waits while the game is paused.
export class HealthSounds {
  constructor(private readonly player: SoundPlayer) {}

  update(feel: HealthFeelState): void {
    if (feel.beatNow) this.player.play('heartbeat', { volume: feel.beatVolume });
    if (feel.breathNow) this.player.play('breath-heavy', { volume: feel.breathVolume });
  }
}
