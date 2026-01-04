/**
 * Core Types — Shared type definitions for canyons.
 *
 * This file contains interfaces and types used across multiple modules.
 * Keeping them separate prevents circular dependencies.
 */

import type { Signal } from './signal';

// --- Signal Types ---

/** A function that takes time and returns a value */
export type SignalFn = (t: number) => number;

// --- Sequence Types ---

/** Rest marker — null values in sequences are skipped */
export type NoteValue = number | null;

/** A sequence value: single note, rest, or chord */
export type SequenceValue = NoteValue | NoteValue[];

/** Function that receives phase signal and returns a signal or number */
export type PhaseFunction = (phase: Signal) => Signal | number;

/** Modifier value: constant, signal, or phase function */
export type ModifierValue = number | Signal | PhaseFunction;

// --- Stream Types ---

/** State returned by Stream.tick() */
export interface StreamState {
  trigger: boolean;
  note: SequenceValue;
  velocity: number;
  phase: number;
  index: number;
  gateOpen: boolean;
  masked: boolean;
  driverValue: number;
  currentFloor: number;
}

// Forward declaration to avoid circular import
// Re-export Stream type for consumers
import type { Stream } from './stream';
export type { Stream };

/** Interface for stream registration (implemented by engine) */
export interface StreamRegistry {
  register(name: string, stream: Stream): void;
}

// --- Event Types ---

/** Note event emitted by the engine */
export interface NoteEvent {
  stream: string;
  note: number;
  velocity: number;
  time: number;
  channel?: number;
}

/** Callback for note events */
export type NoteCallback = (event: NoteEvent) => void;

/** Callback for tick events (visualization) */
export type TickCallback = (
  t: number,
  states: Map<string, StreamState>,
  triggers: Set<string>
) => void;

// --- MIDI Types ---

/** Represents a connected MIDI device */
export interface MidiDevice {
  id: string;
  name: string;
  output: MIDIOutput;
}

/** Active voice in MIDI output */
export interface ActiveVoice {
  channel: number;
  note: number;
  stream: string;
  startTime: number;
}

// --- Internal Synth Types ---

/** Interface for internal synth voices */
export interface InternalVoice {
  note: number;
  channel: number;
  stream: string;
  startTime: number;
  instrument: string;

  setPressure(pressure: number): void;
  setSlide(slide: number): void;
  setBend(bend: number): void;
  release(): void;
}

// --- Output Sink Types ---

/**
 * Handle to an active voice, returned by OutputSink.noteOn().
 * Allows continuous control of the voice (MPE-style).
 */
export interface VoiceHandle {
  /** Update pressure (aftertouch) 0-1 */
  setPressure(pressure: number): void;
  /** Update slide (brightness/CC74) 0-1 */
  setSlide(slide: number): void;
  /** Update pitch bend in semitones */
  setBend(bend: number): void;
  /** Release the voice (note off) */
  release(): void;
}

/**
 * Interface for audio output destinations.
 * Implemented by internal synth and MIDI output.
 * Enables dependency injection for testability.
 */
export interface OutputSink {
  /** Optional initialization with AudioContext */
  init?(ctx: AudioContext): void;

  /** Check if sink is ready to receive events */
  isReady(): boolean;

  /**
   * Start a note, returns a handle for continuous control.
   * Returns null if the sink isn't ready.
   */
  noteOn(
    stream: string,
    note: number,
    velocity: number,
    instrument: string,
    time: number
  ): VoiceHandle | null;

  /** Turn off all notes */
  allNotesOff(): void;
}

// --- Visualization Types ---

/** History entry for visualization */
export interface HistoryEntry {
  t: number;
  streams: Map<string, StreamState>;
  triggers: Set<string>;
}
