import { describe, expect, it } from 'vitest';
import { StanceMachine, type StanceInput, type StanceSettings } from '../src/player/stance';

const settings: StanceSettings = {
  slideDurationSec: 0.5,
  slideCooldownSec: 1,
  slideEntrySpeedMps: 5,
  slideBlockedSpeedMps: 1.5,
  slideStartSpeedMps: 8,
  slideEndSpeedMps: 3,
};
const dt = 0.25; // exact in binary, so the timing below has no rounding noise

const idle: StanceInput = { crouchHeld: false, crouchPressed: false, sprintHeld: false, forwardInput: 0 };
const sprinting: StanceInput = { ...idle, sprintHeld: true, forwardInput: 1 };
const slidePress: StanceInput = { ...sprinting, crouchHeld: true, crouchPressed: true };

describe('StanceMachine', () => {
  it('crouches while C is held and stands when it is released', () => {
    const m = new StanceMachine(settings);
    m.update({ ...idle, crouchHeld: true, crouchPressed: true }, dt, 0);
    expect(m.stance).toBe('crouching');
    m.update(idle, dt, 0);
    expect(m.stance).toBe('standing');
  });

  it('sprints only when Shift is held and moving forward', () => {
    const m = new StanceMachine(settings);
    m.update(sprinting, dt, 4);
    expect(m.sprinting).toBe(true);
    m.update({ ...sprinting, forwardInput: 0 }, dt, 4);
    expect(m.sprinting).toBe(false);
    m.update({ ...sprinting, forwardInput: -1 }, dt, 4);
    expect(m.sprinting).toBe(false);
    m.update({ ...idle, forwardInput: 1 }, dt, 4);
    expect(m.sprinting).toBe(false);
  });

  it('does not sprint while crouching', () => {
    const m = new StanceMachine(settings);
    m.update({ ...sprinting, crouchHeld: true }, dt, 4);
    expect(m.stance).toBe('crouching');
    expect(m.sprinting).toBe(false);
  });

  it('slides when C is pressed while sprinting fast', () => {
    const m = new StanceMachine(settings);
    m.update(slidePress, dt, 6);
    expect(m.stance).toBe('sliding');
    expect(m.slideStarted).toBe(true);
  });

  it('does not slide from standing still, walking, or without sprint', () => {
    for (const [input, speed] of [
      [slidePress, 2], // too slow to slide
      [{ ...slidePress, sprintHeld: false }, 6], // no Shift
      [{ ...slidePress, forwardInput: 0 }, 6], // not moving forward
    ] as const) {
      const m = new StanceMachine(settings);
      m.update(input, dt, speed);
      expect(m.stance).toBe('crouching');
      expect(m.slideStarted).toBe(false);
    }
  });

  it('slows down along the slide and ends after its duration', () => {
    const m = new StanceMachine(settings);
    m.update(slidePress, dt, 6);
    expect(m.slideSpeedMps).toBe(8);
    m.update({ ...idle, crouchHeld: true }, dt, 7); // 0.25 s into 0.5 s
    expect(m.stance).toBe('sliding');
    expect(m.slideSpeedMps).toBeCloseTo(5.5);
    m.update({ ...idle, crouchHeld: true }, dt, 6); // 0.5 s: finished
    expect(m.stance).toBe('crouching');
  });

  it('releasing C does not cancel the slide, but decides crouch or stand at the end', () => {
    const m = new StanceMachine(settings);
    m.update(slidePress, dt, 6);
    m.update(idle, dt, 7); // C released mid-slide
    expect(m.stance).toBe('sliding');
    m.update(idle, dt, 6);
    expect(m.stance).toBe('standing');
  });

  it('ends early when a wall stops the player', () => {
    const m = new StanceMachine(settings);
    m.update(slidePress, dt, 6);
    m.update(idle, dt, 0.5);
    expect(m.stance).toBe('standing');
  });

  it('keeps the slide going when only sliding along a wall (still moving)', () => {
    const m = new StanceMachine(settings);
    m.update(slidePress, dt, 6);
    m.update(idle, dt, 4);
    expect(m.stance).toBe('sliding');
  });

  it('refuses a new slide until the cooldown has passed', () => {
    const m = new StanceMachine(settings);
    m.update(slidePress, dt, 6);
    m.update(idle, dt, 6);
    m.update(idle, dt, 6); // slide over, cooldown starts at 1 s
    expect(m.stance).toBe('standing');

    m.update(slidePress, dt, 6); // 0.75 s left
    expect(m.slideStarted).toBe(false);
    m.update(idle, dt, 6); // 0.5
    m.update(idle, dt, 6); // 0.25
    m.update(idle, dt, 6); // 0
    m.update(slidePress, dt, 6);
    expect(m.slideStarted).toBe(true);
  });
});
