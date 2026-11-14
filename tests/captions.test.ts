import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementSounds } from '../src/audio/movementSounds';
import type { SoundName } from '../src/audio/recipes';
import type { PlayOptions, SoundPlayer } from '../src/audio/soundPlayer';
import { SoundTap } from '../src/audio/soundTap';
import { WeaponSounds } from '../src/audio/weaponSounds';
import { EventBus } from '../src/core/events';
import { CaptionList, formatCaption } from '../src/debug/captions';
import type { WeaponEvents } from '../src/weapons/events';

describe('formatCaption', () => {
  it('says the name, what it is for, the volume, the speed and where it comes from', () => {
    const text = formatCaption('step-metal', { volume: 0.5, rate: 0.97, note: 'walk, right foot, metal', position: new Vector3() }, true);
    expect(text).toBe('step-metal  |  walk, right foot, metal  |  vol 0.50  |  rate 0.97  |  positional');
  });

  it('uses the defaults for a plain sound, and says when nothing can be heard yet', () => {
    expect(formatCaption('dry-click', {}, true)).toBe('dry-click  |  vol 1.00  |  rate 1.00  |  centred');
    expect(formatCaption('dry-click', {}, false)).toContain('NOT AUDIBLE');
  });
});

describe('CaptionList', () => {
  it('keeps only the newest four lines', () => {
    const list = new CaptionList();
    for (let i = 1; i <= 6; i++) list.add(`line ${i}`);
    expect(list.visible().map((l) => l.text)).toEqual(['line 3', 'line 4', 'line 5', 'line 6']);
  });

  it('fades each line out and then drops it, oldest first', () => {
    const list = new CaptionList();
    list.add('old');
    list.update(1);
    list.add('new');
    expect(list.visible()).toHaveLength(2);
    list.update(0.45); // the old one is 1.45 s old: nearly gone
    const [old, fresh] = list.visible();
    expect(old.opacity).toBeLessThan(0.2);
    expect(fresh.opacity).toBe(1);
    list.update(0.1);
    expect(list.visible().map((l) => l.text)).toEqual(['new']);
  });

  it('clear empties it', () => {
    const list = new CaptionList();
    list.add('a');
    list.clear();
    expect(list.visible()).toEqual([]);
  });
});

describe('SoundTap', () => {
  function setup(audible = true) {
    const played: { name: SoundName; options?: PlayOptions }[] = [];
    const ducks: [number, number][] = [];
    const inner: SoundPlayer = { play: (name, options) => void played.push({ name, options }), duck: (a, b) => void ducks.push([a, b]) };
    const tap = new SoundTap(inner, () => audible);
    return { tap, played, ducks };
  }

  it('passes every sound on to the real player, with no listener set', () => {
    const { tap, played } = setup();
    tap.play('dry-click');
    tap.play('impact', { volume: 0.4 });
    expect(played.map((p) => p.name)).toEqual(['dry-click', 'impact']);
    expect(played[1].options?.volume).toBe(0.4);
  });

  it('tells a listener about each sound, and whether it can be heard, and still plays it', () => {
    const { tap, played } = setup(false);
    const heard: [SoundName, boolean][] = [];
    tap.onPlay = (name, _options, audible) => heard.push([name, audible]);
    tap.play('jam-clunk');
    expect(heard).toEqual([['jam-clunk', false]]);
    expect(played).toHaveLength(1);
    tap.onPlay = null;
    tap.play('jam-click');
    expect(heard).toHaveLength(1); // switched off: no more captions
    expect(played).toHaveLength(2);
  });

  it('passes ducking on', () => {
    const { tap, ducks } = setup();
    tap.duck(0.5, 2);
    expect(ducks).toEqual([[0.5, 2]]);
  });

  it('captions every kind of sound in the game, because they all go through it', () => {
    const events = new EventBus<WeaponEvents>();
    const { tap } = setup();
    const heard: string[] = [];
    tap.onPlay = (name) => heard.push(name);
    new WeaponSounds(events, tap, () => 0.5);
    new MovementSounds(events, tap, () => 0.5);
    events.emit('weapon:empty-click', undefined);
    events.emit('player:step', { kind: 'walk', surface: 'tile', foot: 0, position: new Vector3() });
    events.emit('heal:started', undefined);
    expect(heard).toEqual(['dry-click', 'step-tile', 'heal-use']);
  });
});

describe('movement sound notes', () => {
  it('say what each movement sound is for', () => {
    const events = new EventBus<WeaponEvents>();
    const notes: string[] = [];
    const player: SoundPlayer = { play: (_name, options) => void notes.push(options?.note ?? '') };
    new MovementSounds(events, player, () => 0.5);
    const here = new Vector3();
    events.emit('player:step', { kind: 'crouch', surface: 'metal', foot: 1, position: here });
    events.emit('player:slid', { surface: 'tile', position: here });
    events.emit('player:mantled', { kind: 'climb', position: here });
    events.emit('player:landed', { speedMps: 9.8, surface: 'concrete', position: here });
    expect(notes).toEqual(['crouch, right foot, metal', 'slide on tile', 'climb', 'landed at 9.8 m/s on concrete']);
  });
});
