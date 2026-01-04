/**
 * canyons — A sequencer for continuous expression and composition
 *
 * Main entry point. Exports all public API.
 */

// Core primitives
export { Signal, T } from './core/signal';
export { Stream, seq, _ } from './core/stream';

// Audio output
export { engine, stop, hush } from './audio/engine';
export { midi } from './audio/midi';

// Runtime
export { setRegistry, getRegistry } from './runtime/registry';

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
} from './runtime/prelude';

// Configuration
export {
  ENGINE_TICK_HZ,
  ENGINE_FALLBACK_TICK_MS,
  VIZ_THROTTLE_MS,
  VIZ_HISTORY_SIZE,
  MAX_VOICES,
  MPE_MIN_CHANNEL,
  MPE_MAX_CHANNEL,
  DEFAULT_BEND_RANGE,
  EDITOR_DEBOUNCE_MS,
  DEFAULT_VELOCITY,
  KNOWN_INSTRUMENTS,
} from './config';
export type { InstrumentName } from './config';

// Re-export types
export type { SignalFn } from './core/signal';
export type {
  NoteValue,
  SequenceValue,
  PhaseFunction,
  ModifierValue,
  StreamState,
  StreamRegistry,
  NoteEvent,
  NoteCallback,
  TickCallback,
  MidiDevice,
  ActiveVoice,
  InternalVoice,
  HistoryEntry,
} from './core/types';
