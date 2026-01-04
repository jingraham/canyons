/**
 * Configuration — Centralized constants for canyons.
 *
 * All magic numbers live here for visibility, documentation, and testing.
 */

// --- Engine Timing ---

/** Primary tick rate when using AudioWorklet (Hz) */
export const ENGINE_TICK_HZ = 500;

/** Fallback tick interval when AudioWorklet unavailable (ms) */
export const ENGINE_FALLBACK_TICK_MS = 50;

/** Samples per tick at 48kHz sample rate */
export const SAMPLES_PER_TICK = Math.round(48000 / ENGINE_TICK_HZ);

// --- Visualization ---

/** Target visualization update rate (ms between frames) */
export const VIZ_THROTTLE_MS = 16; // ~60fps

/** Number of history entries to keep for signal visualization */
export const VIZ_HISTORY_SIZE = 200;

// --- Voice Allocation ---

/** Maximum number of voices (matches MPE lower zone) */
export const MAX_VOICES = 16;

/** MPE lower zone channel range */
export const MPE_MIN_CHANNEL = 2;
export const MPE_MAX_CHANNEL = 16;

// --- MPE Configuration ---

/** Default pitch bend range in semitones (MPE standard) */
export const DEFAULT_BEND_RANGE = 48;

// --- Editor ---

/** Debounce delay for code evaluation (ms) */
export const EDITOR_DEBOUNCE_MS = 500;

// --- Audio ---

/** Default note velocity when not specified */
export const DEFAULT_VELOCITY = 0.7;

/** Voice release time (ms) */
export const VOICE_RELEASE_MS = 100;

/** Cleanup delay after voice release (ms) */
export const VOICE_CLEANUP_MS = 150;

// --- Known Instruments ---

/** List of all supported internal synth instruments */
export const KNOWN_INSTRUMENTS = [
  'sine',
  'saw',
  'square',
  'triangle',
  'piano',
  'epiano',
  'kick',
  'snare',
  'hihat',
  'pluck',
  'pluckBass',
] as const;

export type InstrumentName = (typeof KNOWN_INSTRUMENTS)[number];
