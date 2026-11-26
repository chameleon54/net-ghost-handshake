import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/audio/wav';

describe('encodeWav', () => {
  const bytes = encodeWav(new Float32Array([0, 1, -1, 2]), 48000);
  const view = new DataView(bytes.buffer);
  const text = (offset: number): string => String.fromCharCode(...bytes.slice(offset, offset + 4));

  it('writes a 16-bit mono PCM header', () => {
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(36)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('stores every sample, clamped to the 16-bit range', () => {
    expect(bytes.length).toBe(44 + 4 * 2);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767]);
  });
});
