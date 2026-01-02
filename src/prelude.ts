/**
 * Standard Prelude — Composer-friendly helpers built on signals.
 *
 * These translate "composer thought" into "signal math."
 * All of these are inspectable — just functions on signals.
 */

import { Signal, T } from './signal';

// --- Time Units ---

/** Convert BPM to a signal (beats since start) */
export const bpm = (n: number): Signal => T.mul(n / 60);

/** Convert Hz to a signal (cycles since start) */
export const hz = (n: number): Signal => T.mul(n);

// --- Per-Note Shapes (functions of phase) ---

/** Swell: 0 → 1 → 0 over the note duration */
export const swell = (p: Signal): Signal => p.mul(Math.PI).sin();

/** Attack: fast rise at note start */
export const attack = (p: Signal): Signal => p.mul(10).min(1);

/** Decay: fall off toward note end */
export const decay = (p: Signal): Signal => p.mul(-1).add(1);

// --- Gate Helpers (functions of phase) ---

/** Legato: note sounds for 95% of period */
export const legato = (p: Signal): Signal => p.lt(0.95);

/** Staccato: note sounds for 30% of period */
export const stacc = (p: Signal): Signal => p.lt(0.3);

/** Tenuto: note sounds for 85% of period */
export const tenuto = (p: Signal): Signal => p.lt(0.85);

// --- Time-Varying Shapes (use global T) ---

/** Breathing modulation: oscillates around 1 with given depth */
export const breath = (period = 8, depth = 0.2): Signal =>
  T.div(period).mul(Math.PI * 2).sin().mul(depth).add(1);

/** Vibrato: oscillates around 0 with given rate and depth */
export const vibrato = (rate = 5, depth = 0.3): Signal =>
  T.mul(rate).mul(Math.PI * 2).sin().mul(depth);

/** Crescendo: linear ramp from 0 to 1 over duration seconds */
export const crescendo = (duration: number): Signal =>
  T.div(duration).min(1);

/** Decrescendo: linear ramp from 1 to 0 over duration seconds */
export const decrescendo = (duration: number): Signal =>
  T.div(duration).mul(-1).add(1).max(0);

// --- Mask Helpers ---

/** Only trigger on certain beats */
export const onBeat = (driver: Signal, n: number): Signal =>
  driver.mod(n).lt(1);

/** Trigger on off-beats */
export const offBeat = (driver: Signal): Signal =>
  driver.add(0.5).mod(1).lt(0.5);
