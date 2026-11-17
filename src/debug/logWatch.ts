import type { EventBus } from '../core/events';
import type { StandInEnemy } from '../enemies/standInEnemy';
import type { SquadCoordinator } from '../squad/squadCoordinator';
import type { WeaponEvents } from '../weapons/events';
import type { EventLog } from './eventLog';
import { aggressionSetting } from '../config/aggression';

// Feeds the debug log (decision 260): watches what the game already exposes (each stand-in's state, the squad's jobs and
// the reasons it gives when nothing happens) once per frame and writes a line when something changes; and listens to a
// few events. It changes nothing in the game.

const heardNames = { dry: 'your gun run dry', reload: 'you reload', jam: 'your gun jam' } as const;
/** The hazard pad hurts a sliver every update: its damage is added up into one line per this long. */
const hazardLineEveryMs = 1000;

interface Parts {
  log: EventLog;
  events: EventBus<WeaponEvents>;
  /** Every stand-in (their letters A to H follow this order), and the ones in the room now. */
  standIns: readonly StandInEnemy[];
  activeStandIns: readonly StandInEnemy[];
  squad: SquadCoordinator;
  flankFailure: () => string | null;
  /** A clock in ms (the browser's by default). */
  now?: () => number;
}

/** What one stand-in looked like at the last check. */
interface Seen {
  state: string;
  flinching: boolean;
  throwing: boolean;
  throwStartedAt: number;
}

export class LogWatch {
  private readonly seen = new Map<StandInEnemy, Seen>();
  private readonly squadSeen = new Map<string, string>();
  private grenadesThrown = 0; // counts "Frag out!", so a throw that ends without one was called off
  private hazardTaken = 0;
  private hazardHealth = 0;
  private hazardSinceMs = 0;
  private readonly now: () => number;

  constructor(private readonly parts: Parts) {
    const { events, log } = parts;
    this.now = parts.now ?? (() => performance.now());
    events.on('enemy:grenade-thrown', () => {
      this.grenadesThrown++;
      log.add('squad', 'Frag out! (an enemy grenade is in the air)');
    });
    events.on('player:damaged', ({ amount, health, source }) => {
      if (source === 'hazard') {
        if (this.hazardTaken === 0) this.hazardSinceMs = this.now();
        this.hazardTaken += amount;
        this.hazardHealth = health;
        return;
      }
      const by = { enemy: 'enemy fire', blast: 'a blast', fall: 'a fall', hazard: 'the hazard pad', debug: 'the dev panel' }[source];
      log.add('Rook', `took ${amount.toFixed(0)} from ${by}, health ${health.toFixed(0)}`);
    });
    events.on('player:healed', ({ amount, health }) => log.add('Rook', `healed ${amount.toFixed(0)}, health ${health.toFixed(0)}`));
    events.on('player:died', ({ source }) => {
      this.writeHazard();
      log.add('Rook', `DIED (${source})`);
      this.squadSeen.delete('setup'); // the restart's tier and count get a line again
    });
    events.on('pickup:taken', ({ kind }) => log.add('Rook', `picked up: ${kind}`));
  }

  /** "C flanker". The squad keeps its members as plain objects, so they are looked up by identity. */
  private who(member: object): string {
    const i = this.parts.standIns.findIndex((enemy) => enemy === member);
    return i < 0 ? '?' : `${'ABCDEFGH'[i] ?? '?'} ${this.parts.standIns[i].role}`;
  }

  private letters(members: readonly object[]): string {
    return members.map((member) => this.who(member).charAt(0)).join(', ');
  }

  /** Writes `text` under `key` when it differs from last time (and is not empty). */
  private squadLine(key: string, text: string): void {
    if (this.squadSeen.get(key) === text) return;
    this.squadSeen.set(key, text);
    if (text) this.parts.log.add('squad', text);
  }

  /** After a Respawn: forget what was seen, so the fresh squad does not show as a wall of changes. */
  reset(): void {
    this.seen.clear();
    this.squadSeen.clear();
    this.parts.log.add('squad', 'respawned');
  }

  /** The hazard pad's damage since the last line, as one line. */
  private writeHazard(): void {
    if (this.hazardTaken === 0) return;
    this.parts.log.add('Rook', `took ${this.hazardTaken.toFixed(0)} from the hazard pad (added up), health ${this.hazardHealth.toFixed(0)}`);
    this.hazardTaken = 0;
  }

  /** Once per frame. */
  update(): void {
    const { log, activeStandIns, squad, flankFailure } = this.parts;
    // The setup, so every run in the log says what it was: at the start, and again after a Respawn, a death or a change.
    this.squadLine('setup', `tier ${aggressionSetting.current}, ${activeStandIns.length} in the room`);
    if (this.hazardTaken > 0 && this.now() - this.hazardSinceMs >= hazardLineEveryMs) this.writeHazard();
    for (const enemy of activeStandIns) {
      const now: Seen = { state: enemy.state, flinching: enemy.flinching, throwing: enemy.isThrowing, throwStartedAt: 0 };
      const before = this.seen.get(enemy);
      if (before) {
        if (now.state !== before.state) log.add(this.who(enemy), `${before.state} -> ${now.state}`);
        if (now.flinching && !before.flinching) log.add(this.who(enemy), 'flinches');
        if (now.throwing && !before.throwing) log.add(this.who(enemy), 'winds up a throw');
        if (!now.throwing && before.throwing) log.add(this.who(enemy), this.grenadesThrown > before.throwStartedAt ? 'threw its grenade' : 'throw called off');
        now.throwStartedAt = now.throwing && before.throwing ? before.throwStartedAt : this.grenadesThrown;
      } else {
        now.throwStartedAt = this.grenadesThrown;
      }
      this.seen.set(enemy, now);
    }

    const flankers = squad.flankers;
    this.squadLine('flank', flankers.length > 1 ? `pincer: ${this.letters(flankers)} flank from both sides` : flankers.length > 0 ? `flank given to ${this.letters(flankers)}` : '');
    this.squadLine('flankFailure', flankFailure() ? `no flank: ${flankFailure()}` : '');
    this.squadLine('suppressor', squad.suppressor ? `${this.letters([squad.suppressor])} pins your cover` : '');
    const movers = [...squad.advancers, ...(squad.repositioner ? [squad.repositioner] : [])];
    this.squadLine('movers', movers.length > 0 ? `${this.letters(movers)} move${movers.length > 1 ? '' : 's'} up` : '');
    this.squadLine('playFailure', squad.playFailure ? `no move-up: ${squad.playFailure}` : '');
    const heard = squad.heardKind;
    this.squadLine(
      'heard',
      !heard ? '' : `heard ${heardNames[heard]}: ${squad.pushIgnored ? 'ignored (this tier does not always react)' : squad.pushedAlready ? 'pushed' : 'push coming'}`,
    );
    const leader = squad.huntLeader;
    this.squadLine(
      'hunt',
      squad.hunting ? `hunt on: ${leader ? `${this.letters([leader])} leads` : 'no leader'}`
        : squad.searching ? 'hunt over, nothing found: holding carefully'
        : squad.huntResult === 'found' ? 'hunt found you'
        : '',
    );
    this.squadLine('huntFollowers', squad.hunting && squad.huntFollowers.length > 0 ? `hunt: ${this.letters(squad.huntFollowers)} follow` : '');
    this.squadLine('huntFailure', squad.huntFailure ? `no hunt: ${squad.huntFailure}` : '');
    this.squadLine('thrower', squad.thrower ? `grenade job given to ${this.letters([squad.thrower])}` : '');
    this.squadLine('grenadeFailure', squad.grenadeFailure ? `no grenade: ${squad.grenadeFailure}` : '');
    // "organised again" only after it was disorganised (the last line under this key is not empty then).
    this.squadLine('disorganised', squad.disorganised ? 'DISORGANISED (leader down)' : this.squadSeen.get('disorganised') ? 'organised again' : '');
  }
}
