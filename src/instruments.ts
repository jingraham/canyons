/**
 * Built-in Instruments — Web Audio synthesizers for canyons.
 *
 * Each instrument is a function that plays a note with the given parameters.
 * Instruments: sine, saw, square, triangle, piano, kick, snare, hihat
 */

export type InstrumentPlayer = (
  ctx: AudioContext,
  freq: number,
  velocity: number,
  duration: number
) => void;

/** Simple sine wave */
export const sine: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(velocity * 0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + duration);
};

/** Saw wave with filter for warmth */
export const saw: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.value = freq;

  // Low-pass filter to soften the saw
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(freq * 4, 8000);
  filter.Q.value = 1;

  gain.gain.setValueAtTime(velocity * 0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + duration);
};

/** Square wave */
export const square: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.value = freq;

  filter.type = 'lowpass';
  filter.frequency.value = Math.min(freq * 3, 6000);

  gain.gain.setValueAtTime(velocity * 0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + duration);
};

/** Triangle wave — soft, flute-like */
export const triangle: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(velocity * 0.4, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + duration);
};

/** Piano-like — multiple detuned oscillators with fast attack, slow decay */
export const piano: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const voices = [0, -3, 3, -6]; // slight detune in cents
  const masterGain = ctx.createGain();
  masterGain.gain.value = velocity * 0.15;
  masterGain.connect(ctx.destination);

  const actualDuration = Math.max(duration, 0.8);

  for (const detune of voices) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = detune;

    // Piano-like envelope: fast attack, slow decay
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + actualDuration);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start();
    osc.stop(ctx.currentTime + actualDuration);
  }
};

/** Electric piano — FM-like bell tones */
export const epiano: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modGain = ctx.createGain();
  const carrierGain = ctx.createGain();

  // FM synthesis: modulator -> modGain -> carrier.frequency
  modulator.frequency.value = freq * 2; // ratio of 2:1
  modGain.gain.value = freq * 0.5; // modulation index

  carrier.frequency.value = freq;

  // Envelope
  const actualDuration = Math.max(duration, 0.6);
  carrierGain.gain.setValueAtTime(0, ctx.currentTime);
  carrierGain.gain.linearRampToValueAtTime(velocity * 0.25, ctx.currentTime + 0.01);
  carrierGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + actualDuration);

  // Modulation envelope (faster decay for bell-like sound)
  modGain.gain.setValueAtTime(freq * 1, ctx.currentTime);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.1, ctx.currentTime + 0.3);

  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(carrierGain);
  carrierGain.connect(ctx.destination);

  modulator.start();
  carrier.start();
  modulator.stop(ctx.currentTime + actualDuration);
  carrier.stop(ctx.currentTime + actualDuration);
};

/** Kick drum — sine wave with pitch envelope */
export const kick: InstrumentPlayer = (ctx, _freq, velocity, _duration) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';

  // Pitch drops from ~150Hz to ~50Hz
  osc.frequency.setValueAtTime(150, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.05);

  // Fast attack, medium decay
  gain.gain.setValueAtTime(velocity * 0.8, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.3);
};

/** Snare drum — noise + tone */
export const snare: InstrumentPlayer = (ctx, _freq, velocity, _duration) => {
  // Noise component
  const bufferSize = ctx.sampleRate * 0.2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1000;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(velocity * 0.3, ctx.currentTime);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  // Tone component
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.value = 180;

  oscGain.gain.setValueAtTime(velocity * 0.4, ctx.currentTime);
  oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);

  noise.start();
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
};

/** Hi-hat — filtered noise */
export const hihat: InstrumentPlayer = (ctx, _freq, velocity, duration) => {
  const bufferSize = ctx.sampleRate * 0.1;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;

  const gain = ctx.createGain();
  const decay = duration < 0.1 ? 0.05 : 0.1; // closed vs open
  gain.gain.setValueAtTime(velocity * 0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + decay);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start();
};

/**
 * Plucked string — Karplus-Strong digital waveguide synthesis.
 * A delay line with a lowpass filter creates realistic plucked sounds.
 */
export const pluck: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const sampleRate = ctx.sampleRate;
  const actualDuration = Math.max(duration, 2); // plucks need time to decay
  const numSamples = Math.ceil(sampleRate * actualDuration);

  // Delay line length determines pitch
  const delayLength = Math.round(sampleRate / freq);

  // Create the delay line (circular buffer), initialize with noise
  const delayLine = new Float32Array(delayLength);
  for (let i = 0; i < delayLength; i++) {
    delayLine[i] = Math.random() * 2 - 1;
  }

  // Pre-render the pluck into a buffer
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const output = buffer.getChannelData(0);

  let readPos = 0;

  // Damping factor (0.996 = slow decay, 0.9 = fast decay)
  const damping = 0.996;

  for (let i = 0; i < numSamples; i++) {
    // Read current sample
    const current = delayLine[readPos];

    // Average with next sample (simple lowpass filter)
    const nextPos = (readPos + 1) % delayLength;
    const filtered = damping * 0.5 * (current + delayLine[nextPos]);

    // Write filtered value back to delay line
    delayLine[readPos] = filtered;

    // Output
    output[i] = current * velocity;

    // Advance read position
    readPos = nextPos;
  }

  // Play the buffer
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.5;

  source.connect(gain);
  gain.connect(ctx.destination);

  source.start();
};

/**
 * Plucked bass — lower damping for warmer, longer decay
 */
export const pluckBass: InstrumentPlayer = (ctx, freq, velocity, duration) => {
  const sampleRate = ctx.sampleRate;
  const actualDuration = Math.max(duration, 3);
  const numSamples = Math.ceil(sampleRate * actualDuration);

  const delayLength = Math.round(sampleRate / freq);
  const delayLine = new Float32Array(delayLength);

  // Softer attack: filtered noise
  for (let i = 0; i < delayLength; i++) {
    delayLine[i] = (Math.random() * 2 - 1) * 0.8;
  }

  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const output = buffer.getChannelData(0);

  let readPos = 0;
  const damping = 0.998; // slower decay for bass

  for (let i = 0; i < numSamples; i++) {
    const current = delayLine[readPos];
    const nextPos = (readPos + 1) % delayLength;

    // Weighted average (more of current = brighter)
    const filtered = damping * (0.4 * current + 0.6 * delayLine[nextPos]);
    delayLine[readPos] = filtered;
    output[i] = current * velocity;
    readPos = nextPos;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.6;

  source.connect(gain);
  gain.connect(ctx.destination);

  source.start();
};

/** Registry of all instruments */
export const instruments: Record<string, InstrumentPlayer> = {
  sine,
  saw,
  square,
  triangle,
  piano,
  epiano,
  kick,
  snare,
  hihat,
  pluck,
  pluckBass,
};

// Track warned instruments to avoid spamming console
const warnedInstruments = new Set<string>();

/** Get an instrument by name, fallback to sine */
export function getInstrument(name: string): InstrumentPlayer {
  if (!instruments[name]) {
    if (!warnedInstruments.has(name)) {
      warnedInstruments.add(name);
      console.warn(
        `[canyons] Unknown instrument "${name}", falling back to "sine". ` +
        `Available: ${Object.keys(instruments).join(', ')}`
      );
    }
    return sine;
  }
  return instruments[name];
}
