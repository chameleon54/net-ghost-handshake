import { audioConfig } from '../config/audio';
import { exposureConfig } from '../config/exposure';
import type { EventBus } from '../core/events';
import { checkHoldProgress } from '../weapons/checkTiming';
import type { WeaponEvents, WeaponId } from '../weapons/events';
import type { SoundName } from './recipes';
import type { SoundPlayer } from './soundPlayer';
import type { Rng } from './synth';

// Where each part of an animation happens, as a share of its length. They match the animations in
// weapons/viewmodel/timeline.ts, so a magazine is heard leaving when it is seen leaving.
const reloadMagOutAt = 0.2;
const reloadMagInAt = 0.82;
const rackPullAt = 0.15;
const rackReleaseAt = 0.5;
const checkMagOutAt = 0.22; // the magazine leaves the well (timeline.ts: slides out from 0.15 to 0.3)
const checkMagInAt = 0.9; // and is pushed home (back in from 0.7 to 0.95)
const inspectChamberPullAt = 0.66;
const inspectChamberReleaseAt = 0.8;
const knifeInspectWhooshAt = 0.3;
const knifeInspectCatchAt = 0.85;
const knifeInspectWhooshVolume = 0.5;

/** The most clicks the taps that clear a jam have their own sound for; the last tap has its own too. */
const distinctRackSounds = 3;
const heatMax = 100;
const clinkSpeedForFullVolumeMps = 3;
const clinkMinVolume = 0.2;
const grenadeBounceMinGapSec = 0.05;
const bounceSpeedForFullVolumeMps = 6;
const bounceMinVolume = 0.25;

interface Scheduled {
  inSec: number;
  group: 'reload' | 'check' | 'inspect';
  play: () => void;
}

// Decides which sound plays for each weapon event, and when. Plain logic with no browser code: it talks to a SoundPlayer.
// Sounds that belong to an animation (the magazine leaving, the slide snapping forward) are scheduled by game time, so
// they follow the animation, wait while the game is paused, and are dropped if the action is interrupted.
export class WeaponSounds {
  private scheduled: Scheduled[] = [];
  private clockSec = 0;
  private lastClinkSec = -Infinity;
  private lastBounceSec = -Infinity;

  constructor(
    events: EventBus<WeaponEvents>,
    private readonly player: SoundPlayer,
    private readonly random: Rng = Math.random,
  ) {
    events.on('weapon:fired', ({ weapon, heat }) => {
      this.cancel('inspect'); // firing ends an inspect
      if (weapon === 'rifle') {
        this.play('rifle-fire');
        // A hot barrel adds a rattle to the shot, louder as it gets hotter.
        if (heat >= audioConfig.rattleStartHeat) {
          const hotness = (heat - audioConfig.rattleStartHeat) / Math.max(heatMax - audioConfig.rattleStartHeat, 1);
          this.play('fire-rattle', Math.min(hotness, 1));
        }
      } else {
        this.play('pistol-fire', audioConfig.pistolLoudness); // suppressed: quieter, never silent
      }
    });
    // Decision 201: the stand-in enemy reuses the M4-A shot, from where it stands, until enemies get their own sounds (4.14).
    events.on('enemy:fired', ({ position }) => this.player.play('rifle-fire', { position, rate: this.rate(), note: 'enemy shot' }));
    // A near miss cracks from where the bullet passed, louder as Rook's exposure rises (4.5).
    events.on('shot:near-miss', ({ position, exposure }) => {
      const volume = exposureConfig.crackQuietVolume + (1 - exposureConfig.crackQuietVolume) * exposure;
      this.player.play('bullet-crack', { position, volume, rate: this.rate(), note: 'bullet crack' });
    });
    events.on('enemy:peek-tell', ({ position }) => this.player.play('enemy-peek-tell', { position, rate: this.rate(), note: 'enemy about to peek' }));
    events.on('weapon:empty-click', () => this.play('dry-click'));
    events.on('weapon:jammed', () => this.play('jam-clunk'));
    events.on('weapon:jam-click', () => this.play('jam-click'));
    events.on('weapon:rack', ({ tap, taps }) => {
      this.cancel('inspect');
      const own = tap < taps ? (`rack-tap-${Math.min(tap, distinctRackSounds)}` as SoundName) : 'rack-final';
      this.play(own);
    });
    events.on('weapon:reload-started', ({ durationSec, rackShare }) => {
      this.cancelAll();
      const swapSec = durationSec * (1 - rackShare);
      this.later(swapSec * reloadMagOutAt, 'reload', () => this.play('mag-out'));
      this.later(swapSec * reloadMagInAt, 'reload', () => this.play('mag-in'));
      if (rackShare > 0) {
        // An empty gun: the rack pulls the slide, then lets it snap forward.
        const rackSec = durationSec * rackShare;
        this.later(swapSec + rackSec * rackPullAt, 'reload', () => this.play('rack-tap-1'));
        this.later(swapSec + rackSec * rackReleaseAt, 'reload', () => this.play('slide-release'));
      }
    });
    events.on('weapon:check-started', ({ durationSec }) => {
      this.cancelAll();
      this.later(durationSec * checkMagOutAt, 'check', () => this.play('check-out'));
    });
    // The put-back begins when R is let go (or the check ran through): the magazine is pushed home near its end.
    events.on('weapon:check-returning', ({ remainingSec }) => {
      this.later(remainingSec * ((checkMagInAt - checkHoldProgress) / (1 - checkHoldProgress)), 'check', () => this.play('check-in'));
    });
    events.on('weapon:inspect-started', ({ weapon, durationSec }) => {
      this.cancel('inspect');
      if (weapon === 'knife') {
        this.later(durationSec * knifeInspectWhooshAt, 'inspect', () => this.play('knife-swing', knifeInspectWhooshVolume));
        this.later(durationSec * knifeInspectCatchAt, 'inspect', () => this.play('draw-knife'));
      } else {
        this.later(durationSec * inspectChamberPullAt, 'inspect', () => this.play('inspect-clack'));
        this.later(durationSec * inspectChamberReleaseAt, 'inspect', () => this.play('slide-release', 0.6));
      }
    });
    events.on('weapon:interrupted', () => {
      this.cancel('reload');
      this.cancel('check');
    });
    events.on('weapon:switched', ({ weapon }) => {
      this.cancelAll(); // the old weapon's sounds stop with it
      this.play(drawSound(weapon));
    });
    events.on('weapon:swing', () => {
      this.cancel('inspect');
      this.play('knife-swing');
    });
    events.on('target:hit', ({ killed, weapon }) => {
      if (weapon === 'knife') this.play('knife-stab');
      this.play(killed ? 'kill-tick' : 'hit-tick');
    });
    events.on('shot:landed', ({ hit, end }) => {
      if (hit) this.player.play('impact', { position: end, rate: this.rate() }); // a bullet in a wall or the floor, where it landed
    });
    events.on('grenade:pin', () => this.play('grenade-pin'));
    events.on('grenade:thrown', () => this.play('grenade-throw'));
    events.on('grenade:bounced', ({ position, speedMps }) => {
      if (this.clockSec - this.lastBounceSec < grenadeBounceMinGapSec) return;
      this.lastBounceSec = this.clockSec;
      const volume = Math.min(Math.max(speedMps / bounceSpeedForFullVolumeMps, bounceMinVolume), 1);
      this.player.play('grenade-bounce', { position, volume, rate: this.rate() });
    });
    events.on('grenade:exploded', ({ position }) => this.player.play('grenade-explosion', { position, rate: this.rate() }));
    // Ringing ears: the hook is ready; it stays silent until the sound's volume is raised (and the real sound added).
    events.on('player:deafened', ({ intensity, durationSec }) => {
      if (audioConfig.earRingingVolume > 0) this.play('ear-ringing', intensity * audioConfig.earRingingVolume);
      if (audioConfig.earRingingDuckShare > 0) this.player.duck?.(audioConfig.earRingingDuckShare * intensity, durationSec);
    });
    events.on('heal:started', () => this.play('heal-use'));
    events.on('player:healed', () => this.play('heal-done'));
    events.on('casing:bounced', ({ position, speedMps }) => {
      if (this.clockSec - this.lastClinkSec < audioConfig.casingClinkMinGapSec) return; // not a wall of clinks in a spray
      this.lastClinkSec = this.clockSec;
      const volume = Math.min(Math.max(speedMps / clinkSpeedForFullVolumeMps, clinkMinVolume), 1);
      this.player.play('casing-clink', { position, volume, rate: this.rate() });
    });
  }

  /** Once per game update. Plays the scheduled sounds that are due. */
  update(dtSec: number): void {
    this.clockSec += dtSec;
    if (this.scheduled.length === 0) return;
    const due: Scheduled[] = [];
    for (const item of this.scheduled) {
      item.inSec -= dtSec;
      if (item.inSec <= 0) due.push(item);
    }
    if (due.length === 0) return;
    this.scheduled = this.scheduled.filter((item) => item.inSec > 0);
    for (const item of due) item.play();
  }

  private later(inSec: number, group: Scheduled['group'], play: () => void): void {
    this.scheduled.push({ inSec, group, play });
  }

  private cancel(group: Scheduled['group']): void {
    this.scheduled = this.scheduled.filter((item) => item.group !== group);
  }

  private cancelAll(): void {
    this.scheduled = [];
  }

  /** A playback speed a little off 1, so repeated sounds are not identical. */
  private rate(): number {
    return 1 + (this.random() * 2 - 1) * audioConfig.pitchVariation;
  }

  private play(name: SoundName, volume = 1): void {
    this.player.play(name, { volume, rate: this.rate() });
  }
}

function drawSound(weapon: WeaponId): SoundName {
  return weapon === 'rifle' ? 'draw-rifle' : weapon === 'pistol' ? 'draw-pistol' : 'draw-knife';
}
