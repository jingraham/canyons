/**
 * canyons — A sequencer for continuous expression and composition
 *
 * Main entry point. Exports all public API.
 */

// Core primitives
export { Signal, T } from './signal';
export { Stream, seq, _, setRegistry, getRegistry } from './stream';
export { engine, stop, hush } from './engine';

// MIDI output
export { midi } from './midi';

// Standard prelude
export {
  bpm,
  hz,
  swell,
  attack,
  decay,
  legato,
  stacc,
  tenuto,
  breath,
  vibrato,
  crescendo,
  decrescendo,
  onBeat,
  offBeat,
} from './prelude';

// Re-export types
export type { SignalFn } from './signal';
export type { NoteValue, SequenceValue, PhaseFunction, ModifierValue, StreamState, StreamRegistry } from './stream';
export type { NoteEvent, NoteCallback } from './engine';
export type { MidiDevice, ActiveVoice } from './midi';
