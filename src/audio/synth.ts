// Small building blocks for making sounds out of nothing: noise, tones, filters. Each one adds into a Float32Array of
// samples (numbers from -1 to 1), so a sound is built by layering. No browser code here, so it can be tested; the sound
// bank turns the numbers into something the browser can play.

export type Rng = () => number;

/** A repeatable random number generator (mulberry32): the same seed always makes the same sound. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of a text to a number, for choosing a seed from a sound's name. */
export function seedFromText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function createSamples(sampleRate: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(Math.round(seconds * sampleRate), 1));
}

const attackSecDefault = 0.0004; // a very short fade-in stops a click at the start of a layer

export interface NoiseOptions {
  /** Where in the sound this layer starts, in seconds. */
  start?: number;
  /** How long the layer lasts at most. */
  duration: number;
  /** Time for the layer to fall to about a third of its loudness. */
  decay: number;
  gain: number;
  /** Rumble below this frequency is removed (a high-pass). */
  highpass?: number;
  /** Everything above this frequency is removed (a low-pass). */
  lowpass?: number;
  attack?: number;
  rng: Rng;
}

/** White noise with a falling loudness, optionally filtered: the crack and body of a shot, clicks and scrapes. */
export function addNoise(samples: Float32Array, sampleRate: number, o: NoiseOptions): void {
  const first = Math.round((o.start ?? 0) * sampleRate);
  const count = Math.min(Math.round(o.duration * sampleRate), samples.length - first);
  const attack = o.attack ?? attackSecDefault;
  // One-pole filters: cheap and good enough for sound effects.
  const lowCoefficient = o.lowpass ? 1 - Math.exp((-2 * Math.PI * o.lowpass) / sampleRate) : 1;
  const highCoefficient = o.highpass ? 1 - Math.exp((-2 * Math.PI * o.highpass) / sampleRate) : 0;
  let low = 0;
  let highState = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    let x = o.rng() * 2 - 1;
    low += lowCoefficient * (x - low);
    x = low;
    if (o.highpass) {
      highState += highCoefficient * (x - highState);
      x -= highState;
    }
    samples[first + i] += x * o.gain * Math.exp(-t / o.decay) * Math.min(t / attack, 1);
  }
}

export interface ToneOptions {
  start?: number;
  duration: number;
  /** Pitch at the start, and at the end (it glides between them): a falling pitch makes a thump. */
  freq: number;
  freqEnd?: number;
  decay: number;
  gain: number;
  shape?: 'sine' | 'square';
  attack?: number;
}

/** A tone with a falling loudness and an optional pitch glide: the thump of a shot, the ring of metal. */
export function addTone(samples: Float32Array, sampleRate: number, o: ToneOptions): void {
  const first = Math.round((o.start ?? 0) * sampleRate);
  const count = Math.min(Math.round(o.duration * sampleRate), samples.length - first);
  const attack = o.attack ?? attackSecDefault;
  const freqEnd = o.freqEnd ?? o.freq;
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const freq = o.freq * Math.pow(freqEnd / o.freq, t / o.duration);
    phase += (2 * Math.PI * freq) / sampleRate;
    const wave = o.shape === 'square' ? Math.sign(Math.sin(phase)) * 0.6 : Math.sin(phase);
    samples[first + i] += wave * o.gain * Math.exp(-t / o.decay) * Math.min(t / attack, 1);
  }
}

export interface SweepOptions {
  start?: number;
  duration: number;
  /** The pitch the whoosh starts at and ends at. */
  fromHz: number;
  toHz: number;
  /** Higher is a narrower, more whistling whoosh. */
  q: number;
  gain: number;
  rng: Rng;
}

/** A whoosh: noise through a band that moves from one pitch to another, fading in and out. */
export function addSweep(samples: Float32Array, sampleRate: number, o: SweepOptions): void {
  const first = Math.round((o.start ?? 0) * sampleRate);
  const count = Math.min(Math.round(o.duration * sampleRate), samples.length - first);
  let low = 0;
  let band = 0;
  const damping = 1 / o.q;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const centre = o.fromHz * Math.pow(o.toHz / o.fromHz, t);
    const f = 2 * Math.sin((Math.PI * centre) / sampleRate);
    const input = o.rng() * 2 - 1;
    low += f * band;
    const high = input - low - damping * band;
    band += f * high;
    const fade = Math.sin(Math.PI * t); // rises and falls: a whoosh, not a hiss
    samples[first + i] += band * o.gain * fade * fade;
  }
}

export interface FinishOptions {
  /** The loudest sample after finishing. Under 1, so layers added together in the game cannot clip. */
  peak: number;
  /** How hard the sound is squashed (soft clipping) to make it dense and punchy. 1 is gentle. */
  drive?: number;
}

const fadeOutSec = 0.003; // the end of every sound is faded, so it never ends with a click

/** Squashes, scales to the wanted peak and fades the very end. Call it last. */
export function finish(samples: Float32Array, sampleRate: number, o: FinishOptions): Float32Array {
  const drive = o.drive ?? 1;
  let loudest = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.tanh(samples[i] * drive);
    loudest = Math.max(loudest, Math.abs(samples[i]));
  }
  const scale = loudest > 0 ? o.peak / loudest : 0;
  const fadeCount = Math.min(Math.round(fadeOutSec * sampleRate), samples.length);
  for (let i = 0; i < samples.length; i++) {
    const fade = i >= samples.length - fadeCount ? (samples.length - i) / fadeCount : 1;
    samples[i] *= scale * fade;
  }
  return samples;
}

export function peakOf(samples: Float32Array): number {
  let loudest = 0;
  for (const value of samples) loudest = Math.max(loudest, Math.abs(value));
  return loudest;
}

/** Loudness (root mean square) of the first `seconds` of a sound. */
export function energyOf(samples: Float32Array, sampleRate: number, seconds: number): number {
  const count = Math.min(Math.round(seconds * sampleRate), samples.length);
  let sum = 0;
  for (let i = 0; i < count; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(count, 1));
}
