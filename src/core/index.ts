/**
 * Core — Pure logic primitives for canyons.
 *
 * This module contains the mathematical core: signals and streams.
 * No side effects, no audio, no DOM — just pure functions.
 */

export { Signal, T } from './signal';
export type { SignalFn } from './signal';

export { Stream, seq, _ } from './stream';

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
} from './types';
