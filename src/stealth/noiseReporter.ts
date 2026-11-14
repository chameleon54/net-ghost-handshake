import type { Vector3 } from 'three';
import { landingLoudness } from '../config/movement';
import { noiseConfig } from '../config/noise';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';
import type { NoiseKind } from './noise';

// Announces the noise each thing the player does makes (`noise:made`), so enemies can hear it later. It listens to the same
// weapon events that the sound and the effects use, so what the player hears and what enemies hear stay in step. Actions
// the player makes no sound with (checking a magazine, inspecting, drawing, aiming) announce nothing. Nothing reacts to a
// noise yet: enemy hearing arrives in 4.10.
export class NoiseReporter {
  constructor(
    private readonly events: EventBus<WeaponEvents>,
    /** Where the player is: most noises come from him. */
    private readonly playerPosition: () => Vector3,
  ) {
    // A suppressed P9 shot is quiet; an M4-A shot is not.
    events.on('weapon:fired', ({ weapon }) =>
      weapon === 'rifle' ? this.fromPlayer('rifle-shot', noiseConfig.rifleShotM) : this.fromPlayer('pistol-shot', noiseConfig.pistolShotM),
    );
    // The bullet hitting a wall or the floor is loud whichever gun it came from: the suppressor only quiets the shot itself.
    // An enemy's bullets are not a noise the player made.
    events.on('shot:landed', ({ hit, end, shooter }) => {
      if (hit && shooter === 'player') this.at('impact', end, noiseConfig.impactM);
    });
    events.on('weapon:empty-click', () => this.fromPlayer('empty-click', noiseConfig.emptyClickM));
    events.on('weapon:reload-started', () => this.fromPlayer('reload', noiseConfig.reloadM));
    events.on('weapon:jammed', () => this.fromPlayer('jam', noiseConfig.jamM));
    events.on('weapon:jam-click', () => this.fromPlayer('jam-click', noiseConfig.jamClickM));
    events.on('weapon:rack', () => this.fromPlayer('rack', noiseConfig.rackM));
    events.on('weapon:swing', () => this.fromPlayer('knife-swing', noiseConfig.knifeSwingM));
    events.on('target:hit', ({ weapon }) => {
      if (weapon === 'knife') this.fromPlayer('knife-stab', noiseConfig.knifeStabM);
    });
    // Movement (3.4): crouching is close to silent, sprinting is loud. A landing carries further the harder it was.
    events.on('player:step', ({ kind, position }) =>
      this.at('footstep', position, kind === 'sprint' ? noiseConfig.sprintStepM : kind === 'crouch' ? noiseConfig.crouchStepM : noiseConfig.walkStepM),
    );
    events.on('player:slid', ({ position }) => this.at('slide', position, noiseConfig.slideM));
    events.on('player:mantled', ({ kind, position }) => this.at(kind, position, kind === 'vault' ? noiseConfig.vaultM : noiseConfig.climbM));
    events.on('player:landed', ({ speedMps, position }) =>
      this.at('landing', position, noiseConfig.landingSoftM + (noiseConfig.landingHardM - noiseConfig.landingSoftM) * landingLoudness(speedMps)),
    );
    events.on('grenade:bounced', ({ position }) => this.at('grenade-bounce', position, noiseConfig.grenadeBounceM));
    events.on('grenade:exploded', ({ position }) => this.at('grenade-blast', position, noiseConfig.grenadeBlastM));
  }

  private fromPlayer(kind: NoiseKind, radiusM: number): void {
    this.at(kind, this.playerPosition(), radiusM);
  }

  /** The position is copied: whoever listens may keep the noise, and the vectors passed around are reused. */
  private at(kind: NoiseKind, position: Vector3, radiusM: number): void {
    this.events.emit('noise:made', { kind, position: position.clone(), radiusM });
  }
}
