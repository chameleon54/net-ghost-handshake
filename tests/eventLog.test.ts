import { describe, expect, it } from 'vitest';
import { clockTime, EventLog } from '../src/debug/eventLog';
import { LogWatch } from '../src/debug/logWatch';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import type { StandInEnemy } from '../src/enemies/standInEnemy';
import type { SquadCoordinator } from '../src/squad/squadCoordinator';

/** A log whose clock starts at 14:32:07.4 and moves on 0.1 s per reading. */
function makeLog() {
  let ms = new Date(2026, 10, 17, 14, 32, 7, 400).getTime();
  const log = new EventLog(() => new Date((ms += 100)));
  const sent: { text: string; fresh: boolean }[] = [];
  const flush = () => {
    log.flush((text, fresh) => sent.push({ text, fresh }));
    return sent;
  };
  return { log, flush };
}

describe('the debug log (decision 260)', () => {
  it('writes clock times to a tenth of a second', () => {
    expect(clockTime(new Date(2026, 10, 17, 9, 5, 3, 470))).toBe('09:05:03.4');
  });

  it('sends its lines once, the first batch fresh (the file starts over), then nothing until there is more', () => {
    const { log, flush } = makeLog();
    log.add('squad', 'flank given to C');
    const sent = flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].fresh).toBe(true);
    expect(sent[0].text).toMatch(/session started[\s\S]*squad\s+flank given to C\n$/);
    flush();
    expect(sent).toHaveLength(1);
    log.mark();
    log.mark();
    flush();
    expect(sent[1].fresh).toBe(false);
    expect(sent[1].text).toContain('--- MARK 1 ---');
    expect(sent[1].text).toContain('--- MARK 2 ---');
  });

  it('writes one slow-frame line per flush: the slowest, and how many others were slow', () => {
    const { log, flush } = makeLog();
    log.slowFrame(20, { aiMs: 1, rays: 1, routes: 0 }); // not slow
    log.slowFrame(30, { aiMs: 2, rays: 100, routes: 1 });
    log.slowFrame(41, { aiMs: 9.8, rays: 1240, routes: 14 });
    log.slowFrame(28, { aiMs: 1, rays: 50, routes: 0 });
    const text = flush()[0].text;
    expect(text.split('\n').filter((line) => line.slice(12).startsWith('frame '))).toHaveLength(1);
    expect(text).toContain('41 ms (AI 9.8 ms, 1240 rays, 14 routes), 2 more slow frames this second');
    log.slowFrame(26, { aiMs: 0.5, rays: 10, routes: 0 });
    expect(flush()[1].text).toMatch(/26 ms \(AI 0\.5 ms, 10 rays, 0 routes\)\n$/);
  });
});

describe('what the debug log watches (decision 260)', () => {
  function makeWatch() {
    const { log, flush } = makeLog();
    const events = new EventBus<WeaponEvents>();
    const enemy = (role: string) => ({ role, state: 'idle', flinching: false, isThrowing: false });
    const a = enemy('leader');
    const b = enemy('trooper');
    const c = enemy('flanker');
    const squad = {
      flankers: [] as object[],
      suppressor: null as object | null,
      advancers: [] as object[],
      repositioner: null,
      playFailure: null,
      heardKind: null as string | null,
      pushIgnored: false,
      pushedAlready: false,
      hunting: false,
      searching: false,
      huntResult: null,
      huntLeader: null,
      huntFollowers: [],
      huntFailure: null,
      thrower: null,
      grenadeFailure: null,
      disorganised: false,
    };
    const standIns = [a, b, c] as unknown as StandInEnemy[];
    const watch = new LogWatch({ log, events, standIns, activeStandIns: standIns, squad: squad as unknown as SquadCoordinator, flankFailure: () => null });
    const lines = () => flush().map((batch) => batch.text).join('').split('\n').slice(1, -1); // without "session started"
    return { watch, events, squad, a, b, c, lines };
  }

  it('says nothing while nothing changes', () => {
    const { watch, lines } = makeWatch();
    for (let i = 0; i < 5; i++) watch.update();
    expect(lines()).toEqual([]);
  });

  it('logs state changes, a flank, a pincer, and the squad getting disorganised and organised again', () => {
    const { watch, squad, a, c, lines } = makeWatch();
    watch.update();
    c.state = 'flank';
    squad.flankers = [c];
    watch.update();
    squad.flankers = [c, a];
    squad.disorganised = true;
    watch.update();
    squad.disorganised = false;
    watch.update();
    watch.update();
    const text = lines().map((line) => line.slice(12)); // without the time
    expect(text).toEqual([
      'C flanker   idle -> flank',
      'squad       flank given to C',
      'squad       pincer: C, A flank from both sides',
      'squad       DISORGANISED (leader down)',
      'squad       organised again',
    ]);
  });

  it('tells a throw that let go ("Frag out!") from one that was called off', () => {
    const { watch, events, b, lines } = makeWatch();
    watch.update();
    b.isThrowing = true;
    watch.update();
    b.isThrowing = false; // no grenade left its hand
    watch.update();
    b.isThrowing = true;
    watch.update();
    events.emit('enemy:grenade-thrown', { position: null as never });
    b.isThrowing = false;
    watch.update();
    const text = lines().map((line) => line.slice(12));
    expect(text).toEqual([
      'B trooper   winds up a throw',
      'B trooper   throw called off',
      'B trooper   winds up a throw',
      'squad       Frag out! (an enemy grenade is in the air)',
      'B trooper   threw its grenade',
    ]);
  });

  it('logs what happens to Rook, and a respawn', () => {
    const { watch, events, lines } = makeWatch();
    events.emit('player:damaged', { amount: 12, health: 63, source: 'enemy' });
    events.emit('player:died', { source: 'blast' });
    watch.reset(8);
    const text = lines().map((line) => line.slice(12));
    expect(text).toEqual(['Rook        took 12 from enemy fire, health 63', 'Rook        DIED (blast)', 'squad       respawned, 8 in the room']);
  });
});
