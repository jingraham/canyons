/**
 * Internal Synth — MIDI/MPE-driven Web Audio synthesizer.
 *
 * Responds to the same messages as external MIDI devices:
 * - noteOn/noteOff with voice allocation
 * - pressure → filter cutoff
 * - slide (CC74) → filter resonance / brightness
 * - bend → pitch
 *
 * This ensures one unified code path for both internal and external control.
 */

export interface InternalVoice {
  note: number;
  channel: number;
  stream: string;
  startTime: number;
  instrument: string;

  // Control methods
  setPressure(pressure: number): void;
  setSlide(slide: number): void;
  setBend(bend: number): void;
  release(): void;
}

/** Convert MIDI note to frequency */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Create a soft saturation curve for analog warmth */
function createSaturationCurve(amount: number = 0.7): Float32Array<ArrayBuffer> {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1; // -1 to 1
    // Soft clipping with tanh-like curve
    curve[i] = Math.tanh(x * (1 + amount * 2)) * (1 - amount * 0.1);
  }
  return curve as Float32Array<ArrayBuffer>;
}

/**
 * Create an internal voice with Web Audio nodes.
 * Signal chain: oscillator → filter → saturator → gain → destination
 * This gives us continuous control over pitch, timbre, and amplitude.
 */
function createVoice(
  ctx: AudioContext,
  note: number,
  velocity: number,
  instrument: string,
  stream: string,
  channel: number,
  time: number
): InternalVoice {
  const baseFreq = midiToFreq(note);

  // Create audio nodes
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const saturator = ctx.createWaveShaper();
  const gain = ctx.createGain();

  // Configure oscillator based on instrument
  switch (instrument) {
    case 'saw':
      osc.type = 'sawtooth';
      break;
    case 'square':
      osc.type = 'square';
      break;
    case 'triangle':
      osc.type = 'triangle';
      break;
    case 'sine':
    default:
      osc.type = 'sine';
      break;
  }

  osc.frequency.value = baseFreq;

  // Filter setup - base cutoff related to note frequency
  // Higher notes get higher cutoff for natural timbre
  filter.type = 'lowpass';
  const baseCutoff = Math.min(baseFreq * 6, 12000);
  filter.frequency.value = baseCutoff;
  filter.Q.value = 1; // Resonance, modulated by slide

  // Saturation for analog warmth (more for saw/square)
  const satAmount = (instrument === 'saw' || instrument === 'square') ? 0.8 : 0.4;
  saturator.curve = createSaturationCurve(satAmount);
  saturator.oversample = '2x'; // Reduce aliasing

  // Gain envelope
  const vol = velocity * 0.35;
  gain.gain.setValueAtTime(vol, ctx.currentTime);

  // Connect: osc → filter → saturator → gain → destination
  osc.connect(filter);
  filter.connect(saturator);
  saturator.connect(gain);
  gain.connect(ctx.destination);

  osc.start();

  // Bend range in semitones (matches MPE default)
  const bendRange = 48;

  return {
    note,
    channel,
    stream,
    startTime: time,
    instrument,

    setPressure(pressure: number): void {
      // Pressure modulates filter cutoff (0-1 → 0.5x to 4x base cutoff)
      // At pressure=0, cutoff is at 50% of base
      // At pressure=1, cutoff opens to 4x base
      const cutoffMult = 0.5 + pressure * 3.5;
      const targetCutoff = Math.min(baseCutoff * cutoffMult, 18000);
      filter.frequency.setTargetAtTime(targetCutoff, ctx.currentTime, 0.02);
    },

    setSlide(slide: number): void {
      // Slide (CC74) modulates filter resonance/Q
      // At slide=0, Q=1 (no resonance)
      // At slide=1, Q=12 (screaming resonance)
      const q = 1 + slide * 11;
      filter.Q.setTargetAtTime(q, ctx.currentTime, 0.02);
    },

    setBend(bend: number): void {
      // Bend is in semitones, convert to frequency ratio
      const semitones = (bend / 1) * bendRange; // bend is normalized -1 to 1
      const ratio = Math.pow(2, semitones / 12);
      osc.frequency.setTargetAtTime(baseFreq * ratio, ctx.currentTime, 0.01);
    },

    release(): void {
      // Fast release envelope
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      // Clean up after release
      setTimeout(() => {
        osc.stop();
        osc.disconnect();
        filter.disconnect();
        saturator.disconnect();
        gain.disconnect();
      }, 150);
    },
  };
}

/**
 * Karplus-Strong voice for plucked string sounds.
 * Pre-renders the pluck but still supports bend during playback.
 */
function createPluckVoice(
  ctx: AudioContext,
  note: number,
  velocity: number,
  instrument: string,
  stream: string,
  channel: number,
  time: number
): InternalVoice {
  const baseFreq = midiToFreq(note);
  const sampleRate = ctx.sampleRate;
  const duration = instrument === 'pluckBass' ? 3 : 2;
  const numSamples = Math.ceil(sampleRate * duration);

  // Delay line for Karplus-Strong
  const delayLength = Math.round(sampleRate / baseFreq);
  const delayLine = new Float32Array(delayLength);

  // Initialize with noise (softer for bass)
  const noiseLevel = instrument === 'pluckBass' ? 0.8 : 1.0;
  for (let i = 0; i < delayLength; i++) {
    delayLine[i] = (Math.random() * 2 - 1) * noiseLevel;
  }

  // Pre-render the pluck
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const output = buffer.getChannelData(0);

  let readPos = 0;
  const damping = instrument === 'pluckBass' ? 0.998 : 0.996;
  const blend = instrument === 'pluckBass' ? 0.4 : 0.5;

  for (let i = 0; i < numSamples; i++) {
    const current = delayLine[readPos];
    const nextPos = (readPos + 1) % delayLength;
    const filtered = damping * (blend * current + (1 - blend) * delayLine[nextPos]);
    delayLine[readPos] = filtered;
    output[i] = current * velocity;
    readPos = nextPos;
  }

  // Play the buffer through a filter for continuous control
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 8000;
  filter.Q.value = 1;

  const gain = ctx.createGain();
  gain.gain.value = 0.5;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  source.start();

  // Note: Pitch bend on plucks requires real-time synthesis which we don't have here.
  // For now, bend is a no-op on plucks. A future enhancement could use a real-time
  // Karplus-Strong implementation in an AudioWorklet.

  return {
    note,
    channel,
    stream,
    startTime: time,
    instrument,

    setPressure(pressure: number): void {
      const cutoff = 2000 + pressure * 14000;
      filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.02);
    },

    setSlide(slide: number): void {
      const q = 1 + slide * 8;
      filter.Q.setTargetAtTime(q, ctx.currentTime, 0.02);
    },

    setBend(_bend: number): void {
      // No-op for pre-rendered plucks
      // Would need AudioWorklet for real-time Karplus-Strong
    },

    release(): void {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      setTimeout(() => {
        source.stop();
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      }, 150);
    },
  };
}

/**
 * Drum voice - simplified, no pitch modulation needed.
 */
function createDrumVoice(
  ctx: AudioContext,
  note: number,
  velocity: number,
  instrument: string,
  stream: string,
  channel: number,
  time: number
): InternalVoice {
  // Fire-and-forget drum sounds with minimal modulation capability
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  if (instrument === 'kick') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.05);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(velocity * 0.8, ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(oscGain);
    oscGain.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } else if (instrument === 'snare') {
    // Noise component
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(velocity * 0.3, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(gain);
    noise.start();

    // Tone component
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180;

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(velocity * 0.4, ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.connect(oscGain);
    oscGain.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } else if (instrument === 'hihat') {
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

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(velocity * 0.2, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(gain);
    noise.start();
  }

  // Drums have minimal modulation - just return a stub voice
  return {
    note,
    channel,
    stream,
    startTime: time,
    instrument,
    setPressure() {},
    setSlide() {},
    setBend() {},
    release() {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    },
  };
}

/**
 * Internal Synth Engine - MIDI/MPE compatible voice management.
 */
class InternalSynth {
  private audioCtx: AudioContext | null = null;
  private voices: InternalVoice[] = [];
  private nextChannel = 1;
  private readonly maxVoices = 16;
  private warnedInstruments = new Set<string>();

  /** Set the audio context */
  setAudioContext(ctx: AudioContext): void {
    this.audioCtx = ctx;
  }

  /** Note on - allocate voice and start sound */
  noteOn(
    stream: string,
    note: number,
    velocity: number,
    instrument: string,
    time: number
  ): number {
    if (!this.audioCtx) return 0;

    // Allocate channel (round-robin)
    const channel = this.nextChannel;
    this.nextChannel = (this.nextChannel % this.maxVoices) + 1;

    // Steal oldest voice if at max
    if (this.voices.length >= this.maxVoices) {
      const oldest = this.voices.shift();
      oldest?.release();
    }

    // Known instruments for this synth
    const knownInstruments = [
      'sine', 'saw', 'square', 'triangle', 'piano', 'epiano',
      'kick', 'snare', 'hihat', 'pluck', 'pluckBass'
    ];

    // Warn once per unknown instrument
    if (!knownInstruments.includes(instrument) && !this.warnedInstruments.has(instrument)) {
      this.warnedInstruments.add(instrument);
      console.warn(
        `[canyons] Unknown instrument "${instrument}", falling back to "sine". ` +
        `Available: ${knownInstruments.join(', ')}`
      );
    }

    // Create appropriate voice type
    let voice: InternalVoice;

    if (['kick', 'snare', 'hihat'].includes(instrument)) {
      voice = createDrumVoice(
        this.audioCtx,
        note,
        velocity,
        instrument,
        stream,
        channel,
        time
      );
    } else if (['pluck', 'pluckBass'].includes(instrument)) {
      voice = createPluckVoice(
        this.audioCtx,
        note,
        velocity,
        instrument,
        stream,
        channel,
        time
      );
    } else {
      voice = createVoice(
        this.audioCtx,
        note,
        velocity,
        instrument,
        stream,
        channel,
        time
      );
    }

    this.voices.push(voice);
    return channel;
  }

  /** Note off - release voice */
  noteOff(stream: string, note: number): void {
    const idx = this.voices.findIndex(
      (v) => v.stream === stream && v.note === note
    );
    if (idx !== -1) {
      const voice = this.voices[idx];
      voice.release();
      this.voices.splice(idx, 1);
    }
  }

  /** Send pressure to all voices of a stream */
  sendPressure(stream: string, pressure: number): void {
    for (const voice of this.voices) {
      if (voice.stream === stream) {
        voice.setPressure(pressure);
      }
    }
  }

  /** Send slide to all voices of a stream */
  sendSlide(stream: string, slide: number): void {
    for (const voice of this.voices) {
      if (voice.stream === stream) {
        voice.setSlide(slide);
      }
    }
  }

  /** Send bend to all voices of a stream */
  sendBend(stream: string, bend: number): void {
    for (const voice of this.voices) {
      if (voice.stream === stream) {
        voice.setBend(bend);
      }
    }
  }

  /** Release all voices */
  allNotesOff(): void {
    for (const voice of this.voices) {
      voice.release();
    }
    this.voices = [];
  }

  /** Get voices for a stream */
  getStreamVoices(stream: string): InternalVoice[] {
    return this.voices.filter((v) => v.stream === stream);
  }
}

/** Global internal synth instance */
export const internalSynth = new InternalSynth();
