import { describe, expect, it } from 'vitest';
import { calloutText, SpeechLines } from '../src/debug/speech';

describe('dev speech above heads (4.17)', () => {
  it('words each callout, a flank with its side', () => {
    expect(calloutText('reloading')).toBe('Reloading!');
    expect(calloutText('need_cover')).toBe('Need cover!');
    expect(calloutText('flank_start', 'left')).toBe('Flanking left!');
    expect(calloutText('flank_start')).toBe('Flanking!');
  });

  it('a line stays up 2 s; a newer one from the same speaker replaces it and starts its time again', () => {
    const lines = new SpeechLines<string>();
    lines.say('A', 'Reloading!');
    lines.update(1.5);
    expect(lines.textOf('A')).toBe('Reloading!');
    lines.say('A', 'Moving up!');
    lines.update(1.5);
    expect(lines.textOf('A')).toBe('Moving up!');
    lines.update(0.6);
    expect(lines.textOf('A')).toBe(null);
    expect(lines.textOf('B')).toBe(null);
  });
});
