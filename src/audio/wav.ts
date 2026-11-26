// Turns a sound made in code (numbers from -1 to 1) into the bytes of a .wav file: 16-bit, one channel. Used by
// `npm run export-sounds` (scripts/exportSounds.mjs) so the sounds can be carried to the Unity version (decision 292).

const headerBytes = 44;
const bytesPerSample = 2;

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * bytesPerSample;
  const bytes = new Uint8Array(headerBytes + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  text(0, 'RIFF');
  view.setUint32(4, headerBytes - 8 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of the format block
  view.setUint16(20, 1, true); // plain PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // bytes per second
  view.setUint16(32, bytesPerSample, true); // bytes per sample frame
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(headerBytes + i * bytesPerSample, Math.round(clamped * 32767), true);
  }
  return bytes;
}
