import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { WeaponEvents } from '../src/weapons/events';
import { EnemySteps, type Walker } from '../src/enemies/enemySteps';
import { EnemySounds } from '../src/audio/enemySounds';
import { farthestBeyond } from '../src/audio/audioSystem';
import { downCaller, pushCaller, sideWord } from '../src/squad/callouts';
import { enemySoundConfig } from '../src/config/enemySounds';
import type { SoundName } from '../src/audio/recipes';
import type { PlayOptions } from '../src/audio/soundPlayer';
import type { Role } from '../src/config/roles';
import type { StandInState } from '../src/enemies/standInEnemy';

const stepSec = 1 / 60;

/** A walker that moves along x at `speedMps` for `seconds`, with the step counter updating every 1/60 s. */
function walk(steps: EnemySteps, walker: { xM: number; zM: number; role: Role; state: StandInState; crouched: boolean }, speedMps: number, seconds: number) {
  for (let t = 0; t < seconds; t += stepSec) {
    walker.xM += speedMps * stepSec;
    steps.update(stepSec, [walker]);
  }
}

function makeSteps() {
  const events = new EventBus<WeaponEvents>();
  const heard: WeaponEvents['enemy:step'][] = [];
  events.on('enemy:step', (step) => heard.push({ ...step, position: step.position.clone() }));
  const steps = new EnemySteps(events, (x) => (x > 10 ? 'metal' : 'concrete'));
  const walker = { xM: 0, zM: 0, role: 'trooper' as Role, state: 'cover' as StandInState, crouched: false };
  steps.update(stepSec, [walker]); // the first update only notes where it is
  return { events, heard, steps, walker };
}

describe('enemy footsteps (4.14)', () => {
  it('walking: a step every walking stride, feet alternating, from where it is', () => {
    const { heard, steps, walker } = makeSteps();
    walk(steps, walker, 2.5, 3); // 7.5 m at a trooper's walk
    expect(heard.length).toBe(Math.floor(7.5 / enemySoundConfig.strideWalkM));
    expect(heard.every((s) => s.gait === 'walk' && s.role === 'trooper' && s.surface === 'concrete')).toBe(true);
    expect(heard.map((s) => s.foot).slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(heard[0].position.x).toBeCloseTo(enemySoundConfig.strideWalkM, 1);
  });

  it('running: longer strides, so fewer steps for the same distance; the surface under it', () => {
    const { heard, steps, walker } = makeSteps();
    walker.xM = 11; // on the metal patch of this test's floor
    steps.update(stepSec, [walker]); // a 11 m jump: not walking, starts over
    expect(heard).toHaveLength(0);
    walk(steps, walker, 4, 2); // 8 m at a trooper's run
    expect(heard.length).toBe(Math.floor(8 / enemySoundConfig.strideRunM));
    expect(heard.every((s) => s.gait === 'run' && s.surface === 'metal')).toBe(true);
  });

  it('crouched: short strides; standing, falling and down: no steps', () => {
    const { heard, steps, walker } = makeSteps();
    walker.crouched = true;
    walk(steps, walker, 1.5, 1);
    expect(heard.length).toBe(Math.floor(1.5 / enemySoundConfig.strideCrouchM));
    expect(heard.every((s) => s.gait === 'crouch')).toBe(true);
    heard.length = 0;
    walker.crouched = false;
    walk(steps, walker, 0, 2); // standing still
    walker.state = 'falling';
    walk(steps, walker, 3, 1); // tipping over moves it, but makes no steps
    walker.state = 'down';
    walk(steps, walker, 3, 1);
    expect(heard).toHaveLength(0);
  });

  it('each enemy keeps its own count and feet', () => {
    const { heard, steps } = makeSteps();
    const a: Walker & { xM: number } = { xM: 0, zM: 0, role: 'flanker', state: 'flank', crouched: false };
    const b: Walker & { xM: number } = { xM: 0, zM: 5, role: 'heavy', state: 'advance', crouched: false };
    for (let t = 0; t < 2; t += stepSec) {
      a.xM += 4.5 * stepSec;
      b.xM += 1.8 * stepSec;
      steps.update(stepSec, [a, b]);
    }
    expect(heard.filter((s) => s.role === 'flanker').length).toBe(Math.floor(9 / enemySoundConfig.strideRunM));
    expect(heard.filter((s) => s.role === 'heavy').length).toBe(Math.floor(3.6 / enemySoundConfig.strideWalkM));
  });
});

describe('enemy sounds (4.14)', () => {
  function makeSounds() {
    const events = new EventBus<WeaponEvents>();
    const played: { name: SoundName; options: PlayOptions }[] = [];
    new EnemySounds(events, { play: (name, options = {}) => played.push({ name, options }) }, () => 0.5); // no random pitch
    return { events, played };
  }

  it('a step plays the surface\'s step sound from where it landed; the heavy louder and deeper; running louder than walking', () => {
    const { events, played } = makeSounds();
    const at = { x: 1, y: 0, z: 2 } as never;
    events.emit('enemy:step', { position: at, surface: 'tile', foot: 0, role: 'trooper', gait: 'walk' });
    events.emit('enemy:step', { position: at, surface: 'tile', foot: 0, role: 'trooper', gait: 'run' });
    events.emit('enemy:step', { position: at, surface: 'metal', foot: 0, role: 'heavy', gait: 'walk' });
    events.emit('enemy:step', { position: at, surface: 'concrete', foot: 0, role: 'trooper', gait: 'crouch' });
    const [walkStep, runStep, heavyStep, crouchStep] = played;
    expect(walkStep.name).toBe('step-tile');
    expect(walkStep.options.position).toBe(at);
    expect(runStep.options.volume!).toBeGreaterThan(walkStep.options.volume!);
    expect(crouchStep.options.volume!).toBeLessThan(walkStep.options.volume!);
    expect(heavyStep.name).toBe('step-metal');
    expect(heavyStep.options.volume!).toBeGreaterThan(walkStep.options.volume!);
    expect(heavyStep.options.rate!).toBeLessThan(walkStep.options.rate!);
  });

  it('each gun has its own shot: pistol, rifle, machine gun', () => {
    const { events, played } = makeSounds();
    const at = { x: 0, y: 1.5, z: 0 } as never;
    for (const gun of ['pistol', 'rifle', 'lmg'] as const) events.emit('enemy:fired', { position: at, gun });
    expect(played.map((p) => p.name)).toEqual(['enemy-pistol-fire', 'rifle-fire', 'enemy-mg-fire']);
    expect(played.every((p) => p.options.position === at)).toBe(true);
  });
});

describe('footstep voices (4.14)', () => {
  it('a new step takes over the farthest one playing, only if that one is farther; otherwise it is dropped', () => {
    expect(farthestBeyond([3, 12, 7], 5)).toBe(1);
    expect(farthestBeyond([3, 4, 2], 5)).toBe(-1);
    expect(farthestBeyond([], 5)).toBe(-1);
  });
});

describe('who calls out (4.14)', () => {
  const member = (role: Role, xM: number, awake = true) => ({ role, xM, zM: 0, awake });

  it('a push is called by the leader if it is up, else by the one nearest Rook', () => {
    const squad = [member('trooper', 10), member('leader', 20), member('flanker', 2)];
    expect(pushCaller(squad, { x: 0, z: 0 })).toBe(squad[1]);
    const noLeader = [member('trooper', 10), member('leader', 20, false), member('flanker', 2)];
    expect(pushCaller(noLeader, { x: 0, z: 0 })).toBe(noLeader[2]);
    expect(pushCaller([member('trooper', 1, false)], { x: 0, z: 0 })).toBeNull();
  });

  it('"man down" is called by the awake squadmate nearest where it fell', () => {
    const squad = [member('trooper', 10), member('heavy', 4), member('flanker', 5, false)];
    expect(downCaller(squad, { x: 5, z: 0 })).toBe(squad[1]);
  });

  it('a flank side as Rook sees it', () => {
    expect(sideWord(1)).toBe('right');
    expect(sideWord(-1)).toBe('left');
  });
});
