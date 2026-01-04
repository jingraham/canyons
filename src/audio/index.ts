/**
 * Audio — Web Audio and MIDI output for canyons.
 *
 * This module handles all audio side effects:
 * - Internal synthesizer (Web Audio)
 * - MIDI/MPE output
 * - Engine tick loop and scheduling
 */

export { engine, stop, hush } from './engine';
export { midi } from './midi';
export { internalSynth } from './synth';
