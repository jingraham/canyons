/**
 * Engine — The core tick loop and audio output.
 *
 * Runs at 500Hz using AudioWorklet for precise timing.
 * Falls back to setInterval at 20Hz if worklet unavailable.
 */

import type { Stream, StreamState } from './stream';
import { midi } from './midi';
import { getInstrument } from './instruments';

export interface NoteEvent {
  stream: string;
  note: number;
  velocity: number;
  time: number;
  channel?: number; // MIDI channel if MIDI is enabled
}

export type NoteCallback = (event: NoteEvent) => void;

/** Tracks currently sounding notes for gate handling */
interface ActiveNote {
  note: number;
  channel: number;
  gateOpen: boolean;
}

// AudioWorklet processor code as a string (inlined for Vite compatibility)
const tickProcessorCode = `
class TickProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samplesSinceTick = 0;
    this.samplesPerTick = Math.round(sampleRate / 500); // 500Hz
    this.running = false;
    this.startFrame = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'start') {
        this.running = true;
        this.startFrame = currentFrame;
        this.samplesSinceTick = 0;
      } else if (e.data.type === 'stop') {
        this.running = false;
      }
    };
  }

  process() {
    if (!this.running) return true;

    this.samplesSinceTick += 128;

    while (this.samplesSinceTick >= this.samplesPerTick) {
      this.samplesSinceTick -= this.samplesPerTick;
      const elapsedFrames = currentFrame - this.startFrame;
      const t = elapsedFrames / sampleRate;
      this.port.postMessage({ type: 'tick', t });
    }

    return true;
  }
}

registerProcessor('tick-processor', TickProcessor);
`;

class Engine {
  private streams = new Map<string, Stream>();
  private running = false;
  private startTime = 0;
  private intervalId: number | null = null;
  private audioCtx: AudioContext | null = null;

  // AudioWorklet state
  private workletNode: AudioWorkletNode | null = null;
  private workletReady = false;
  private useWorklet = true;

  // Track active notes per stream for gate handling
  private activeNotes = new Map<string, ActiveNote[]>();

  // Hot reload: track which streams were touched during current eval
  private touchedStreams = new Set<string>();

  // Callbacks
  private onNote: NoteCallback | null = null;
  private onTick: ((t: number, states: Map<string, StreamState>, triggers: Set<string>) => void) | null = null;

  // Throttle visualization updates (60fps max)
  private lastVizUpdate = 0;
  private readonly vizThrottleMs = 16; // ~60fps

  // Accumulate triggers between viz frames
  private pendingTriggers = new Set<string>();

  // Config
  readonly tickHz = 500;
  readonly fallbackTickMs = 50; // 20Hz fallback

  /** Begin a hot reload cycle - call before evaluating new code */
  beginHotReload(): void {
    this.touchedStreams.clear();
  }

  /** End a hot reload cycle - removes streams that weren't re-registered */
  endHotReload(): void {
    const midiReady = midi.isReady();

    for (const [name] of this.streams) {
      if (!this.touchedStreams.has(name)) {
        // Stream wasn't touched - remove it
        // First send note-offs for any active notes
        const activeNotes = this.activeNotes.get(name);
        if (activeNotes && midiReady) {
          for (const active of activeNotes) {
            midi.noteOff(name, active.note);
          }
        }
        this.activeNotes.delete(name);
        this.streams.delete(name);
      }
    }
  }

  /** Register a stream (hot reload aware) */
  register(name: string, stream: Stream): void {
    this.touchedStreams.add(name);

    const existing = this.streams.get(name);
    if (existing) {
      // Hot reload: transfer state from old stream to new
      stream.transferStateFrom(existing);

      // Send note-off for any currently sounding notes before structural change
      const midiReady = midi.isReady();
      const activeNotes = this.activeNotes.get(name);
      if (activeNotes && midiReady) {
        for (const active of activeNotes) {
          midi.noteOff(name, active.note);
        }
      }
      this.activeNotes.delete(name);
    }

    this.streams.set(name, stream);
  }

  /** Unregister a stream */
  unregister(name: string): void {
    this.streams.delete(name);
  }

  /** Stop and remove a stream */
  stop(name: string): void {
    this.streams.delete(name);
  }

  /** Stop all streams */
  hush(): void {
    this.streams.clear();
  }

  /** Get all registered streams */
  getStreams(): Map<string, Stream> {
    return this.streams;
  }

  /** Set note callback */
  setNoteCallback(cb: NoteCallback): void {
    this.onNote = cb;
  }

  /** Set tick callback (for visualization) */
  setTickCallback(cb: (t: number, states: Map<string, StreamState>, triggers: Set<string>) => void): void {
    this.onTick = cb;
  }

  /** Get or create audio context */
  getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  /** Initialize AudioWorklet */
  private async initWorklet(): Promise<boolean> {
    try {
      const ctx = this.getAudioContext();

      // Create a blob URL from the processor code
      const blob = new Blob([tickProcessorCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      this.workletNode = new AudioWorkletNode(ctx, 'tick-processor');
      this.workletNode.connect(ctx.destination); // Must be connected to run

      // Listen for tick messages
      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === 'tick') {
          this.tick(e.data.t);
        }
      };

      this.workletReady = true;
      console.log('AudioWorklet initialized (500Hz tick)');
      return true;
    } catch (err) {
      console.warn('AudioWorklet not available, falling back to setInterval:', err);
      this.useWorklet = false;
      return false;
    }
  }

  /** Play a note using Web Audio with the specified instrument */
  playNote(freq: number, duration = 0.15, velocity = 0.5, instrument = 'sine'): void {
    const ctx = this.getAudioContext();
    const player = getInstrument(instrument);
    player(ctx, freq, velocity, duration);
  }

  /** Convert MIDI note to frequency */
  midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** Start the engine */
  async start(): Promise<void> {
    if (this.running) return;

    // Ensure audio context is ready
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Initialize worklet if not ready
    if (this.useWorklet && !this.workletReady) {
      await this.initWorklet();
    }

    this.running = true;
    this.startTime = performance.now();

    // Reset all streams and active notes
    for (const stream of this.streams.values()) {
      stream.reset();
    }
    this.activeNotes.clear();

    // Send all notes off to MIDI to start clean
    if (midi.isReady()) {
      midi.allNotesOff();
    }

    if (this.useWorklet && this.workletReady && this.workletNode) {
      // Start the worklet clock
      this.workletNode.port.postMessage({ type: 'start' });
    } else {
      // Fallback to setInterval
      this.intervalId = window.setInterval(() => {
        this.tick(this.currentTime());
      }, this.fallbackTickMs);
    }
  }

  /** Stop the engine */
  shutdown(): void {
    this.running = false;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Send all notes off to MIDI
    if (midi.isReady()) {
      midi.allNotesOff();
    }
    this.activeNotes.clear();
  }

  /** Check if engine is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get current time in seconds */
  currentTime(): number {
    if (!this.running) return 0;
    return (performance.now() - this.startTime) / 1000;
  }

  /** Main tick function */
  private tick(t: number): void {
    if (!this.running) return;

    const states = new Map<string, StreamState>();
    const midiReady = midi.isReady();

    for (const [name, stream] of this.streams) {
      const state = stream.tick(t);
      states.set(name, state);

      // Get or create active notes list for this stream
      if (!this.activeNotes.has(name)) {
        this.activeNotes.set(name, []);
      }
      const streamNotes = this.activeNotes.get(name)!;

      if (state.trigger) {
        // Accumulate trigger for viz
        this.pendingTriggers.add(name);

        // Turn off any currently active notes for this stream before new trigger
        for (const activeNote of streamNotes) {
          if (midiReady) {
            midi.noteOff(name, activeNote.note);
          }
        }
        streamNotes.length = 0;

        // Handle note trigger
        const notes = Array.isArray(state.note) ? state.note : [state.note];

        for (const note of notes) {
          if (note === null) continue;

          // Play internal sound with the stream's instrument
          this.playNote(this.midiToFreq(note), 0.2, state.velocity, stream.instrument);

          // Send MIDI note on
          let channel = 0;
          if (midiReady) {
            channel = midi.noteOn(name, note, state.velocity, t);
          }

          // Track active note
          streamNotes.push({ note, channel, gateOpen: true });

          // Fire callback
          if (this.onNote) {
            this.onNote({
              stream: name,
              note,
              velocity: state.velocity,
              time: t,
              channel: midiReady ? channel : undefined,
            });
          }
        }
      }

      // Handle gate changes for active notes
      for (const activeNote of streamNotes) {
        if (activeNote.gateOpen && !state.gateOpen) {
          // Gate just closed — send note off
          if (midiReady) {
            midi.noteOff(name, activeNote.note);
          }
          activeNote.gateOpen = false;
        }
      }

      // Send continuous MPE data for active notes
      if (midiReady && streamNotes.length > 0) {
        const pressure = stream.getPressure(t, state.phase);
        const slide = stream.getSlide(t, state.phase);
        const bend = stream.getBend(t, state.phase);

        for (const activeNote of streamNotes) {
          if (activeNote.gateOpen) {
            if (pressure !== 0) midi.sendPressure(activeNote.channel, pressure);
            if (slide !== 0) midi.sendSlide(activeNote.channel, slide);
            if (bend !== 0) midi.sendBend(activeNote.channel, bend);
          }
        }
      }
    }

    // Throttle visualization updates to 60fps
    const now = performance.now();
    if (this.onTick && now - this.lastVizUpdate >= this.vizThrottleMs) {
      this.lastVizUpdate = now;
      this.onTick(t, states, new Set(this.pendingTriggers));
      this.pendingTriggers.clear();
    }
  }

  /** Get the MIDI output instance */
  getMidi() {
    return midi;
  }
}

/** Global engine instance */
export const engine = new Engine();

/** Stop a named stream */
export function stop(name: string): void {
  engine.stop(name);
}

/** Stop all streams */
export function hush(): void {
  engine.hush();
}
