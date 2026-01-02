/**
 * Engine — The core tick loop and audio output.
 *
 * Runs at ~20Hz (50ms intervals) for Phase 1.
 * Will move to AudioWorklet at 500Hz in later phases.
 */

import type { Stream, StreamState } from './stream';
import { midi } from './midi';

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

class Engine {
  private streams = new Map<string, Stream>();
  private running = false;
  private startTime = 0;
  private intervalId: number | null = null;
  private audioCtx: AudioContext | null = null;

  // Track active notes per stream for gate handling
  private activeNotes = new Map<string, ActiveNote[]>();

  // Callbacks
  private onNote: NoteCallback | null = null;
  private onTick: ((t: number, states: Map<string, StreamState>) => void) | null = null;

  // Config
  readonly tickMs = 50; // 20Hz

  /** Register a stream */
  register(name: string, stream: Stream): void {
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
  setTickCallback(cb: (t: number, states: Map<string, StreamState>) => void): void {
    this.onTick = cb;
  }

  /** Get or create audio context */
  getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  /** Play a note using Web Audio */
  playNote(freq: number, duration = 0.15, velocity = 0.5): void {
    const ctx = this.getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;

    gain.gain.value = velocity * 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  /** Convert MIDI note to frequency */
  midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** Start the engine */
  start(): void {
    if (this.running) return;

    // Ensure audio context is ready
    this.getAudioContext();

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

    this.intervalId = window.setInterval(() => this.tick(), this.tickMs);
  }

  /** Stop the engine */
  shutdown(): void {
    this.running = false;
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
  private tick(): void {
    if (!this.running) return;

    const t = this.currentTime();
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

          // Play internal sound
          this.playNote(this.midiToFreq(note), 0.2, state.velocity);

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

    // Fire tick callback for visualization
    if (this.onTick) {
      this.onTick(t, states);
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
