import { describe, expect, it } from 'vitest';
import { Input } from '../src/core/input';

describe('Input mouse buttons and wheel', () => {
  it('a click between two updates is still seen once, even if released', () => {
    const input = new Input();
    input.enabled = true;
    input.buttonDown(0);
    input.buttonUp(0);
    expect(input.consumeButtonPress(0)).toBe(true);
    expect(input.consumeButtonPress(0)).toBe(false);
    expect(input.isButtonDown(0)).toBe(false);
  });

  it('holding a button gives one press, not one per update', () => {
    const input = new Input();
    input.enabled = true;
    input.buttonDown(0);
    input.buttonDown(0);
    expect(input.consumeButtonPress(0)).toBe(true);
    expect(input.consumeButtonPress(0)).toBe(false);
  });

  it('wheel movement turns into whole steps and keeps the fraction', () => {
    const input = new Input();
    input.enabled = true;
    input.addWheel(0.4);
    expect(input.consumeWheelSteps()).toBe(0);
    input.addWheel(0.7);
    expect(input.consumeWheelSteps()).toBe(1);
    input.addWheel(-3); // 0.1 was left over, so -2.9
    expect(input.consumeWheelSteps()).toBe(-2);
  });

  it('ignores the wheel and buttons while not playing, and clear forgets them', () => {
    const input = new Input();
    input.addWheel(3);
    input.buttonDown(0);
    expect(input.consumeWheelSteps()).toBe(0);
    expect(input.consumeButtonPress(0)).toBe(false);
    input.enabled = true;
    input.addWheel(3);
    input.buttonDown(0);
    input.clear();
    expect(input.consumeWheelSteps()).toBe(0);
    expect(input.consumeButtonPress(0)).toBe(false);
  });
});
