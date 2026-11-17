import { enemySoundConfig } from '../config/enemySounds';
import type { EnemyGun } from '../config/enemyGuns';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import { stepSounds } from './movementSounds';
import type { SoundName } from './recipes';
import type { SoundPlayer } from './soundPlayer';
import type { Rng } from './synth';

/** Each enemy gun's shot (4.14): the troopers' rifle is Rook's own M4-A sound; the pistol and machine gun have their own. */
const gunSounds: Record<EnemyGun, SoundName> = { pistol: 'enemy-pistol-fire', rifle: 'rifle-fire', lmg: 'enemy-mg-fire' };
const gunVolume = (gun: EnemyGun): number =>
  gun === 'pistol' ? enemySoundConfig.pistolVolume : gun === 'lmg' ? enemySoundConfig.lmgVolume : enemySoundConfig.rifleVolume;
const pitchVariationShare = 0.03; // a little random on every sound, so repeats do not sound the same

// The squad's sounds (4.14, decision 264): footsteps from where each foot lands (by surface, gait and role: the heavy is
// heavier), and each gun's shot from its muzzle. All positional, so you can place them by ear. Plain logic with no browser
// code: it talks to a SoundPlayer. The peek tell, the bullet crack and the enemy grenade's sounds stay in WeaponSounds.
export class EnemySounds {
  constructor(
    events: EventBus<WeaponEvents>,
    private readonly player: SoundPlayer,
    private readonly random: Rng = Math.random,
  ) {
    events.on('enemy:step', ({ position, surface, foot, role, gait }) => {
      const c = enemySoundConfig;
      const heavy = role === 'heavy';
      const volume = (gait === 'run' ? c.stepVolumeRun : gait === 'crouch' ? c.stepVolumeCrouch : c.stepVolumeWalk) * (heavy ? c.heavyStepLoudness : 1);
      const footPitch = (foot === 0 ? -1 : 1) * c.footPitchShare;
      const rate = (heavy ? c.heavyStepPitch : 1) * (1 + footPitch + this.jitter());
      this.player.play(stepSounds[surface], { position, volume, rate, note: `enemy ${role}, ${gait}, ${surface}` });
    });
    // A reload (4.16): Rook's magazine sounds from where the enemy is, so a reload nearby can be heard (and pushed).
    events.on('enemy:reload', ({ phase, position, gun }) =>
      this.player.play(phase === 'start' ? 'mag-out' : 'mag-in', { position, volume: enemySoundConfig.reloadVolume, rate: 1 + this.jitter(), note: `enemy ${gun} reload ${phase}` }),
    );
    events.on('enemy:fired', ({ position, gun }) =>
      this.player.play(gunSounds[gun], { position, volume: gunVolume(gun), rate: 1 + this.jitter(), note: `enemy ${gun} shot` }),
    );
  }

  private jitter(): number {
    return (this.random() * 2 - 1) * pitchVariationShare;
  }
}
