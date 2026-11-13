import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { Input } from '../src/core/input';

describe('Input', () => {
  it('ignores presses while disabled', () => {
    const input = new Input();
    input.keyDown('KeyW');
    expect(input.isKeyDown('KeyW')).toBe(false);
  });

  it('tracks held keys and buttons while enabled', () => {
    const input = new Input();
    input.enabled = true;
    input.keyDown('KeyW');
    input.buttonDown(0);
    expect(input.isKeyDown('KeyW')).toBe(true);
    expect(input.isButtonDown(0)).toBe(true);
  });

  it('reports a key press once, even if the key was released before it was read', () => {
    const input = new Input();
    input.enabled = true;
    input.keyDown('KeyC');
    input.keyUp('KeyC');
    expect(input.consumePress('KeyC')).toBe(true);
    expect(input.consumePress('KeyC')).toBe(false);
  });

  it('does not report a held key as pressed again, and forgets presses on clear', () => {
    const input = new Input();
    input.enabled = true;
    input.keyDown('KeyC');
    input.consumePress('KeyC');
    input.keyDown('KeyC'); // still held
    expect(input.consumePress('KeyC')).toBe(false);
    input.keyUp('KeyC');
    input.keyDown('KeyC');
    input.clear();
    expect(input.consumePress('KeyC')).toBe(false);
  });

  it('returns mouse movement once, then zero', () => {
    const input = new Input();
    input.enabled = true;
    input.addMouseMove(3, -2);
    input.addMouseMove(1, 1);
    const out = { x: 0, y: 0 };
    input.consumeMouseMove(out);
    expect(out).toEqual({ x: 4, y: -1 });
    input.consumeMouseMove(out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe('Game pause rules', () => {
  function setup() {
    const input = new Input();
    let released = 0;
    const game = new Game(input, () => released++);
    return { input, game, released: () => released };
  }

  it('starts in the menu and plays once the mouse is captured', () => {
    const { game, input } = setup();
    expect(game.state).toBe('menu');
    game.handleLockChange(true);
    expect(game.state).toBe('playing');
    expect(input.enabled).toBe(true);
  });

  it('pauses when the capture is lost, and clears held keys so none stay stuck', () => {
    const { game, input } = setup();
    game.handleLockChange(true);
    input.keyDown('KeyW');
    game.handleLockChange(false);
    expect(game.state).toBe('paused');
    expect(input.enabled).toBe(false);
    expect(input.isKeyDown('KeyW')).toBe(false);
  });

  it('pauses and releases the mouse when the tab loses focus', () => {
    const { game, released } = setup();
    game.handleLockChange(true);
    game.handleFocusLost();
    expect(game.state).toBe('paused');
    expect(released()).toBe(1);
  });

  it('ignores focus loss when not playing', () => {
    const { game, released } = setup();
    game.handleFocusLost();
    expect(game.state).toBe('menu');
    expect(released()).toBe(0);
  });

  it('resumes when the mouse is captured again', () => {
    const { game } = setup();
    game.handleLockChange(true);
    game.handleLockChange(false);
    game.handleLockChange(true);
    expect(game.state).toBe('playing');
  });
});
