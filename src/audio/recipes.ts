import { addNoise, addSweep, addTone, createRng, createSamples, finish, seedFromText, type Rng } from './synth';

// Every sound the weapons make, as a recipe: layers of noise and tones added together and squashed. They are the built-in
// sounds. A real recording named like `sfx-rifle-fire-01.ogg` in src/assets/audio/ replaces the recipe of the same name.

export const soundNames = [
  'rifle-fire',
  'pistol-fire',
  'fire-rattle',
  'dry-click',
  'jam-clunk',
  'jam-click',
  'rack-tap-1',
  'rack-tap-2',
  'rack-tap-3',
  'rack-final',
  'slide-release',
  'mag-out',
  'mag-in',
  'check-out',
  'check-in',
  'inspect-clack',
  'draw-rifle',
  'draw-pistol',
  'draw-knife',
  'knife-swing',
  'knife-stab',
  'hit-tick',
  'kill-tick',
  'impact',
  'casing-clink',
  'grenade-pin',
  'grenade-throw',
  'grenade-bounce',
  'grenade-explosion',
  'ear-ringing',
  'heal-use',
  'heal-done',
  'heartbeat',
  'breath-heavy',
  'step-concrete',
  'step-metal',
  'step-tile',
  'slide',
  'vault',
  'climb',
  'land-soft',
  'land-hard',
  'enemy-peek-tell',
] as const;

export type SoundName = (typeof soundNames)[number];

/** Which volume group a sound belongs to (see config/audio.ts). */
export type SoundGroup = 'weapon' | 'handling' | 'impact' | 'movement';

interface Recipe {
  group: SoundGroup;
  /** How many slightly different versions to make. They are picked at random so repeats do not sound the same. */
  variants: number;
  make: (sampleRate: number, rng: Rng, variant: number) => Float32Array;
}

/** A random number between `low` and `high`, from the sound's own generator. */
const between = (rng: Rng, low: number, high: number): number => low + (high - low) * rng();

const metalClick = (samples: Float32Array, sr: number, rng: Rng, start: number, gain: number, ringHz: number): void => {
  addNoise(samples, sr, { start, duration: 0.03, decay: 0.006, gain, highpass: 1800, lowpass: 7000, rng });
  addTone(samples, sr, { start, duration: 0.12, freq: ringHz, decay: 0.03, gain: gain * 0.3 });
};

const thunk = (samples: Float32Array, sr: number, start: number, gain: number, from: number, to: number): void => {
  addTone(samples, sr, { start, duration: 0.15, freq: from, freqEnd: to, decay: 0.045, gain });
};

export const recipes: Record<SoundName, Recipe> = {
  // A loud, layered shot: a sharp crack, a body, a low thump, and a short tail of room.
  'rifle-fire': {
    group: 'weapon',
    variants: 3,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.5);
      addNoise(s, sr, { duration: 0.05, decay: 0.011, gain: 1.0, highpass: between(rng, 2200, 3200), attack: 0.0002, rng });
      addNoise(s, sr, { duration: 0.15, decay: 0.045, gain: 0.8, highpass: 300, lowpass: between(rng, 3000, 4200), rng });
      addNoise(s, sr, { start: 0.002, duration: 0.25, decay: 0.09, gain: 0.55, lowpass: 1200, rng });
      thunk(s, sr, 0, 1.1, between(rng, 120, 160), 45);
      addNoise(s, sr, { start: 0.02, duration: 0.45, decay: 0.25, gain: 0.16, lowpass: 1800, rng });
      return finish(s, sr, { peak: 0.95, drive: 2.2 });
    },
  },
  // Suppressed: a soft "pff", a dull thud, and the clack of the slide. Never silent.
  'pistol-fire': {
    group: 'weapon',
    variants: 3,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.35);
      addNoise(s, sr, { duration: 0.12, decay: 0.03, gain: 0.7, highpass: 250, lowpass: between(rng, 1500, 2200), rng });
      thunk(s, sr, 0, 0.6, between(rng, 100, 125), 60);
      metalClick(s, sr, rng, 0.012, 0.5, between(rng, 1700, 2000));
      addNoise(s, sr, { start: 0.03, duration: 0.3, decay: 0.12, gain: 0.07, lowpass: 1500, rng });
      return finish(s, sr, { peak: 0.7, drive: 1.6 });
    },
  },
  // A few quick metallic ticks, added on top of a shot when the barrel is very hot.
  'fire-rattle': {
    group: 'weapon',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.18);
      for (const start of [0, 0.035, 0.07, 0.1]) {
        addNoise(s, sr, { start, duration: 0.02, decay: 0.006, gain: between(rng, 0.5, 0.8), highpass: 3000, lowpass: 8000, rng });
        addTone(s, sr, { start, duration: 0.05, freq: between(rng, 2000, 2600), decay: 0.015, gain: 0.2 });
      }
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // An empty gun: a dry double tick.
  'dry-click': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.09);
      addNoise(s, sr, { duration: 0.02, decay: 0.004, gain: 1, highpass: 3000, rng });
      addTone(s, sr, { duration: 0.05, freq: 2600, decay: 0.008, gain: 0.4 });
      addNoise(s, sr, { start: 0.018, duration: 0.02, decay: 0.004, gain: 0.35, highpass: 2000, rng });
      return finish(s, sr, { peak: 0.6 });
    },
  },
  // A jam: a dull, dead clunk, nothing like the dry click.
  'jam-clunk': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.25);
      thunk(s, sr, 0, 0.9, 180, 70);
      addNoise(s, sr, { duration: 0.12, decay: 0.05, gain: 0.7, lowpass: 900, rng });
      addNoise(s, sr, { start: 0.03, duration: 0.02, decay: 0.004, gain: 0.5, highpass: 2500, rng });
      return finish(s, sr, { peak: 0.8, drive: 1.4 });
    },
  },
  // Pulling the trigger of a jammed gun again: a duller, lighter dead click.
  'jam-click': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.12);
      addNoise(s, sr, { duration: 0.06, decay: 0.02, gain: 0.8, highpass: 200, lowpass: 1200, rng });
      addTone(s, sr, { duration: 0.08, freq: 220, decay: 0.03, gain: 0.4 });
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // The taps that clear a jam each have their own pitch, so they are not the same sound four times.
  'rack-tap-1': { group: 'handling', variants: 1, make: (sr, rng) => rack(sr, rng, 1900) },
  'rack-tap-2': { group: 'handling', variants: 1, make: (sr, rng) => rack(sr, rng, 2150) },
  'rack-tap-3': { group: 'handling', variants: 1, make: (sr, rng) => rack(sr, rng, 2400) },
  // The last tap: the stuck round is thrown out, with a heavier clunk and a bright ring.
  'rack-final': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.3);
      for (const [start, gain] of [[0, 0.7], [0.07, 1]] as const) {
        addNoise(s, sr, { start, duration: 0.04, decay: 0.014, gain, highpass: 1000, lowpass: 7000, rng });
      }
      thunk(s, sr, 0.07, 0.8, 160, 80);
      addTone(s, sr, { start: 0.07, duration: 0.25, freq: 3200, decay: 0.09, gain: 0.25 });
      return finish(s, sr, { peak: 0.85, drive: 1.3 });
    },
  },
  // The slide or bolt snapping forward.
  'slide-release': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.15);
      addNoise(s, sr, { duration: 0.05, decay: 0.02, gain: 1, highpass: 1200, lowpass: 7000, rng });
      addTone(s, sr, { duration: 0.1, freq: 2600, decay: 0.05, gain: 0.3 });
      thunk(s, sr, 0, 0.5, 120, 80);
      return finish(s, sr, { peak: 0.8, drive: 1.3 });
    },
  },
  // The magazine sliding out, and clicking in.
  'mag-out': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.2);
      addNoise(s, sr, { duration: 0.1, decay: 0.04, gain: 0.7, highpass: 500, lowpass: 4000, rng });
      metalClick(s, sr, rng, 0.03, 0.6, 2200);
      thunk(s, sr, 0.05, 0.4, 200, 120);
      return finish(s, sr, { peak: 0.7 });
    },
  },
  'mag-in': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.2);
      thunk(s, sr, 0, 0.8, 160, 90);
      metalClick(s, sr, rng, 0.008, 0.8, 2500);
      addNoise(s, sr, { duration: 0.08, decay: 0.03, gain: 0.4, lowpass: 3000, rng });
      return finish(s, sr, { peak: 0.8, drive: 1.3 });
    },
  },
  // Checking the magazine: softer than a reload.
  'check-out': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.25);
      addNoise(s, sr, { duration: 0.15, decay: 0.06, gain: 0.4, highpass: 600, lowpass: 3500, rng });
      metalClick(s, sr, rng, 0.05, 0.4, 2000);
      return finish(s, sr, { peak: 0.5 });
    },
  },
  'check-in': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.2);
      thunk(s, sr, 0, 0.5, 160, 100);
      metalClick(s, sr, rng, 0.008, 0.5, 2300);
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // The chamber check in an inspect: a small metallic clack.
  'inspect-clack': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.12);
      metalClick(s, sr, rng, 0, 0.8, 2400);
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // Taking a weapon out: a swish of cloth, then a clunk (a high shing for the knife).
  'draw-rifle': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.35);
      addSweep(s, sr, { duration: 0.17, fromHz: 600, toHz: 2500, q: 1.2, gain: 1.4, rng });
      thunk(s, sr, 0.17, 0.5, 130, 80);
      metalClick(s, sr, rng, 0.18, 0.4, 2200);
      return finish(s, sr, { peak: 0.6 });
    },
  },
  'draw-pistol': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.25);
      addSweep(s, sr, { duration: 0.12, fromHz: 800, toHz: 3000, q: 1.2, gain: 1.2, rng });
      thunk(s, sr, 0.12, 0.35, 150, 100);
      metalClick(s, sr, rng, 0.125, 0.35, 2500);
      return finish(s, sr, { peak: 0.5 });
    },
  },
  'draw-knife': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.22);
      addSweep(s, sr, { duration: 0.12, fromHz: 2500, toHz: 5500, q: 3, gain: 1.2, rng });
      addTone(s, sr, { start: 0.08, duration: 0.14, freq: 4200, decay: 0.12, gain: 0.15 });
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // A swing through the air, and a stab into something.
  'knife-swing': {
    group: 'handling',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.2);
      addSweep(s, sr, { duration: 0.16, fromHz: between(rng, 400, 600), toHz: between(rng, 2200, 3200), q: 1.6, gain: 1.8, rng });
      return finish(s, sr, { peak: 0.6 });
    },
  },
  'knife-stab': {
    group: 'weapon',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.2);
      thunk(s, sr, 0, 0.9, 110, 60);
      addNoise(s, sr, { duration: 0.1, decay: 0.05, gain: 0.7, lowpass: 900, rng });
      addNoise(s, sr, { start: 0.01, duration: 0.06, decay: 0.03, gain: 0.3, highpass: 1500, lowpass: 3500, rng });
      return finish(s, sr, { peak: 0.75 });
    },
  },
  // Hit confirmation: a tick for a hit, a two-note tick for a kill.
  'hit-tick': {
    group: 'impact',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.06);
      addTone(s, sr, { duration: 0.05, freq: 1800, decay: 0.012, gain: 0.7 });
      addNoise(s, sr, { duration: 0.01, decay: 0.004, gain: 0.4, highpass: 3000, rng });
      return finish(s, sr, { peak: 0.5 });
    },
  },
  'kill-tick': {
    group: 'impact',
    variants: 1,
    make: (sr) => {
      const s = createSamples(sr, 0.14);
      addTone(s, sr, { duration: 0.08, freq: 1500, decay: 0.035, gain: 0.6 });
      addTone(s, sr, { start: 0.045, duration: 0.09, freq: 2250, decay: 0.035, gain: 0.6 });
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // A bullet hitting a wall or the floor: a tick on top of a thud.
  'impact': {
    group: 'impact',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.18);
      addNoise(s, sr, { duration: 0.1, decay: 0.03, gain: 0.7, highpass: 200, lowpass: between(rng, 2000, 3000), rng });
      thunk(s, sr, 0, 0.5, between(rng, 140, 180), 80);
      addNoise(s, sr, { duration: 0.02, decay: 0.004, gain: 0.3, highpass: 4000, rng });
      return finish(s, sr, { peak: 0.6 });
    },
  },
  // Brass bouncing on a hard floor: a small, high ring.
  'casing-clink': {
    group: 'impact',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.18);
      addTone(s, sr, { duration: 0.12, freq: between(rng, 4000, 4600), decay: 0.05, gain: 0.35 });
      addTone(s, sr, { duration: 0.14, freq: between(rng, 5100, 5700), decay: 0.07, gain: 0.25 });
      addNoise(s, sr, { duration: 0.01, decay: 0.004, gain: 0.3, highpass: 5000, rng });
      return finish(s, sr, { peak: 0.4 });
    },
  },
  // The pin pulled: a small metal ting and a click.
  'grenade-pin': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.16);
      addTone(s, sr, { duration: 0.14, freq: 3300, decay: 0.05, gain: 0.5 });
      metalClick(s, sr, rng, 0, 0.7, 2600);
      addNoise(s, sr, { start: 0.05, duration: 0.03, decay: 0.01, gain: 0.3, highpass: 1500, lowpass: 6000, rng });
      return finish(s, sr, { peak: 0.6 });
    },
  },
  // A throw: a whoosh with a little grunt of air.
  'grenade-throw': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.3);
      addSweep(s, sr, { duration: 0.22, fromHz: 300, toHz: 1500, q: 1.1, gain: 1.6, rng });
      thunk(s, sr, 0.02, 0.2, 120, 70);
      return finish(s, sr, { peak: 0.6 });
    },
  },
  // A metal body bouncing on a hard surface: a clunk with a short ring.
  'grenade-bounce': {
    group: 'impact',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.25);
      thunk(s, sr, 0, 0.8, between(rng, 260, 340), 140);
      addNoise(s, sr, { duration: 0.08, decay: 0.02, gain: 0.5, lowpass: 3000, rng });
      addTone(s, sr, { duration: 0.2, freq: between(rng, 1600, 2000), decay: 0.06, gain: 0.18 });
      return finish(s, sr, { peak: 0.65 });
    },
  },
  // A blast: a crack, a huge thump that falls in pitch, and a long rumbling tail.
  'grenade-explosion': {
    group: 'weapon',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 1.8);
      addNoise(s, sr, { duration: 0.12, decay: 0.03, gain: 0.9, highpass: 1500, attack: 0.0002, rng });
      addNoise(s, sr, { duration: 0.5, decay: 0.16, gain: 1.0, lowpass: 1800, rng });
      addTone(s, sr, { duration: 0.8, freq: between(rng, 85, 100), freqEnd: 26, decay: 0.28, gain: 1.5 });
      addNoise(s, sr, { start: 0.05, duration: 1.7, decay: 0.55, gain: 0.5, lowpass: 450, rng });
      return finish(s, sr, { peak: 0.98, drive: 2.6 });
    },
  },
  // A placeholder for the ringing of ears after a close blast: a thin high tone that fades. Replace it with a real
  // recording by adding src/assets/audio/sfx-ear-ringing.ogg. It is silent in the game until its volume is raised.
  'ear-ringing': {
    group: 'weapon',
    variants: 1,
    make: (sr) => {
      const s = createSamples(sr, 3);
      addTone(s, sr, { duration: 3, freq: 4200, decay: 1.2, gain: 0.5, attack: 0.05 });
      addTone(s, sr, { duration: 3, freq: 6100, decay: 0.8, gain: 0.15, attack: 0.05 });
      return finish(s, sr, { peak: 0.3 });
    },
  },
  // An enemy about to peek out of cover (4.4): a quick rattle of gear and a scuff of cloth, the warning before it fires.
  'enemy-peek-tell': {
    group: 'handling',
    variants: 2,
    make: (sr, rng, variant) => {
      const s = createSamples(sr, 0.35);
      addNoise(s, sr, { duration: 0.22, decay: 0.1, gain: 0.45, highpass: 1200, lowpass: 5000, attack: 0.02, rng });
      metalClick(s, sr, rng, 0.04, 0.5, 2600 + variant * 300);
      metalClick(s, sr, rng, 0.11, 0.35, 3100 - variant * 200);
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // A heal item opened: a snap of the cap, then a soft hiss of the dose going in.
  'heal-use': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.9);
      metalClick(s, sr, rng, 0, 0.8, 2100);
      addNoise(s, sr, { start: 0.05, duration: 0.7, decay: 0.3, gain: 0.45, highpass: 3500, lowpass: 9000, attack: 0.04, rng });
      thunk(s, sr, 0.04, 0.25, 180, 110);
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // The dose done: two soft rising notes.
  'heal-done': {
    group: 'handling',
    variants: 1,
    make: (sr) => {
      const s = createSamples(sr, 0.5);
      addTone(s, sr, { duration: 0.25, freq: 660, decay: 0.08, gain: 0.5, attack: 0.005 });
      addTone(s, sr, { start: 0.12, duration: 0.35, freq: 880, decay: 0.12, gain: 0.5, attack: 0.005 });
      return finish(s, sr, { peak: 0.45 });
    },
  },
  // A heartbeat: a low "lub", then a softer "dub" a moment later. Mostly felt, not heard.
  'heartbeat': {
    group: 'handling',
    variants: 1,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.55);
      addTone(s, sr, { duration: 0.2, freq: 62, freqEnd: 40, decay: 0.07, gain: 1.0, attack: 0.008 });
      addNoise(s, sr, { duration: 0.12, decay: 0.04, gain: 0.25, lowpass: 220, attack: 0.008, rng });
      addTone(s, sr, { start: 0.2, duration: 0.2, freq: 55, freqEnd: 38, decay: 0.07, gain: 0.7, attack: 0.008 });
      return finish(s, sr, { peak: 0.7 });
    },
  },
  // One tired breath: air in, then out, as soft filtered noise.
  'breath-heavy': {
    group: 'handling',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 1.4);
      addNoise(s, sr, { duration: 0.6, decay: 0.5, gain: 0.7, highpass: 250, lowpass: between(rng, 1800, 2400), attack: 0.22, rng });
      addNoise(s, sr, { start: 0.55, duration: 0.8, decay: 0.25, gain: 0.55, highpass: 200, lowpass: between(rng, 1300, 1800), attack: 0.12, rng });
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // Footsteps, one per surface. Several versions each, picked at random, so a walk does not repeat one sample.
  // Concrete: a dull thud with a gritty scuff.
  'step-concrete': {
    group: 'movement',
    variants: 4,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.22);
      thunk(s, sr, 0, 0.8, between(rng, 95, 125), 55);
      addNoise(s, sr, { duration: 0.1, decay: 0.03, gain: 0.7, highpass: 200, lowpass: between(rng, 1400, 2000), rng });
      addNoise(s, sr, { start: 0.015, duration: 0.08, decay: 0.03, gain: 0.25, highpass: 2500, lowpass: 6000, rng });
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // Metal grating: a hollow clank with a short ring.
  'step-metal': {
    group: 'movement',
    variants: 4,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.35);
      thunk(s, sr, 0, 0.6, between(rng, 130, 170), 80);
      addNoise(s, sr, { duration: 0.06, decay: 0.015, gain: 0.6, highpass: 800, lowpass: 5000, rng });
      addTone(s, sr, { duration: 0.3, freq: between(rng, 420, 520), decay: 0.09, gain: 0.3 });
      addTone(s, sr, { duration: 0.25, freq: between(rng, 1100, 1400), decay: 0.06, gain: 0.15 });
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // Tile: a sharp click on a hard floor with a faint thud under it.
  'step-tile': {
    group: 'movement',
    variants: 4,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.16);
      addNoise(s, sr, { duration: 0.03, decay: 0.008, gain: 0.9, highpass: 1500, lowpass: 8000, rng });
      addTone(s, sr, { duration: 0.08, freq: between(rng, 1700, 2100), decay: 0.02, gain: 0.3 });
      thunk(s, sr, 0, 0.4, between(rng, 110, 140), 70);
      return finish(s, sr, { peak: 0.5 });
    },
  },
  // A slide: a long scuff of cloth and boots that fades out.
  'slide': {
    group: 'movement',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.8);
      addNoise(s, sr, { duration: 0.75, decay: 0.3, gain: 0.8, highpass: 350, lowpass: between(rng, 2600, 3400), attack: 0.06, rng });
      addNoise(s, sr, { duration: 0.6, decay: 0.25, gain: 0.3, highpass: 2500, lowpass: 7000, attack: 0.05, rng });
      thunk(s, sr, 0, 0.35, 100, 60);
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // A vault: a rush of cloth over the obstacle, then a boot tap on the far side.
  'vault': {
    group: 'movement',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.6);
      addSweep(s, sr, { duration: 0.34, fromHz: 300, toHz: 1300, q: 1.2, gain: 1.3, rng });
      addNoise(s, sr, { start: 0.04, duration: 0.2, decay: 0.08, gain: 0.25, highpass: 400, lowpass: 3000, attack: 0.03, rng });
      thunk(s, sr, 0.34, 0.6, between(rng, 120, 150), 70);
      addNoise(s, sr, { start: 0.34, duration: 0.08, decay: 0.025, gain: 0.5, highpass: 200, lowpass: 2200, rng });
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // A climb: hands slapping and boots scraping up the face of the obstacle, then a push over the edge.
  'climb': {
    group: 'movement',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.9);
      for (const start of [0, 0.22, 0.44]) {
        addNoise(s, sr, { start, duration: 0.14, decay: 0.05, gain: 0.55, highpass: 500, lowpass: between(rng, 3000, 4200), attack: 0.01, rng });
        thunk(s, sr, start + 0.02, 0.35, between(rng, 140, 190), 90);
      }
      addNoise(s, sr, { start: 0.62, duration: 0.25, decay: 0.1, gain: 0.45, highpass: 300, lowpass: 2600, attack: 0.05, rng });
      thunk(s, sr, 0.7, 0.5, 110, 60);
      return finish(s, sr, { peak: 0.55 });
    },
  },
  // Landings: a light one, and a heavy one for a hard fall.
  'land-soft': {
    group: 'movement',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.3);
      thunk(s, sr, 0, 1.0, between(rng, 100, 125), 55);
      addNoise(s, sr, { duration: 0.12, decay: 0.04, gain: 0.6, lowpass: 1300, rng });
      return finish(s, sr, { peak: 0.6 });
    },
  },
  'land-hard': {
    group: 'movement',
    variants: 2,
    make: (sr, rng) => {
      const s = createSamples(sr, 0.7);
      thunk(s, sr, 0, 1.4, between(rng, 75, 95), 32);
      addTone(s, sr, { duration: 0.5, freq: 48, freqEnd: 28, decay: 0.15, gain: 1.0 });
      addNoise(s, sr, { duration: 0.25, decay: 0.08, gain: 0.9, lowpass: 1000, rng });
      addNoise(s, sr, { duration: 0.04, decay: 0.01, gain: 0.6, highpass: 1500, lowpass: 6000, rng });
      return finish(s, sr, { peak: 0.8, drive: 1.8 });
    },
  },
};

/** A metallic rack of a slide or bolt: a pull, then a release a moment later. `ringHz` makes each tap its own pitch. */
function rack(sr: number, rng: Rng, ringHz: number): Float32Array {
  const s = createSamples(sr, 0.2);
  metalClick(s, sr, rng, 0, 0.8, ringHz);
  addNoise(s, sr, { start: 0.07, duration: 0.05, decay: 0.02, gain: 0.9, highpass: 1000, lowpass: 7000, rng });
  addTone(s, sr, { start: 0.07, duration: 0.12, freq: ringHz * 0.8, decay: 0.06, gain: 0.3 });
  return finish(s, sr, { peak: 0.7 });
}

/** Makes the sound samples for one version of a sound. The same name and version always make the same sound. */
export function makeSound(name: SoundName, variant: number, sampleRate: number): Float32Array {
  const rng = createRng(seedFromText(`${name}#${variant}`));
  return recipes[name].make(sampleRate, rng, variant);
}
