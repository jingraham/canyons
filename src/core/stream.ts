/**
 * Stream — A sequence of values driven by a signal.
 *
 * Discrete events emerge from integer crossings of the driver signal.
 * This module is pure — no global state or runtime dependencies.
 */

import { Signal } from './signal';
import { DEFAULT_VELOCITY } from '../config';
import type {
  SequenceValue,
  PhaseFunction,
  ModifierValue,
  StreamState,
  StreamRegistry,
} from './types';

/** Rest marker — null values in sequences are skipped */
export const _ = null;

export class Stream {
  readonly values: SequenceValue[];
  readonly driver: Signal;
  name: string | null = null;

  // Modifier values
  private _vel: ModifierValue | null = null;
  private _gate: PhaseFunction | null = null;
  private _pressure: ModifierValue | null = null;
  private _slide: ModifierValue | null = null;
  private _bend: ModifierValue | null = null;
  private _mask: Signal | null = null;
  private _inst: string = 'sine';

  // State for integer crossing detection (hysteresis)
  private _lastFloor: number | null = null;

  constructor(values: SequenceValue[], driver: Signal) {
    this.values = values;
    this.driver = driver;
  }

  // --- Modifiers (fluent API) ---

  vel(v: ModifierValue): this {
    this._vel = v;
    return this;
  }

  gate(g: PhaseFunction): this {
    this._gate = g;
    return this;
  }

  pressure(p: ModifierValue): this {
    this._pressure = p;
    return this;
  }

  slide(s: ModifierValue): this {
    this._slide = s;
    return this;
  }

  bend(b: ModifierValue): this {
    this._bend = b;
    return this;
  }

  mask(m: Signal): this {
    this._mask = m;
    return this;
  }

  inst(name: string): this {
    this._inst = name;
    return this;
  }

  /** Register this stream with a registry (if provided) */
  as(name: string, registry?: StreamRegistry | null): this {
    this.name = name;
    if (registry) {
      registry.register(name, this);
    }
    return this;
  }

  /** Get the instrument name */
  get instrument(): string {
    return this._inst;
  }

  /** Reset state (called on engine start) */
  reset(): void {
    this._lastFloor = null;
  }

  /** Transfer internal state from another stream (for hot reload) */
  transferStateFrom(other: Stream): void {
    this._lastFloor = other._lastFloor;
  }

  // Track NaN warnings to avoid spam (one warning per stream)
  private _warnedNaN = false;

  /** Evaluate a modifier value at time t with given phase */
  private evalModifier(mod: ModifierValue | null, t: number, phase: number, defaultVal: number): number {
    if (mod === null) return defaultVal;

    let value: number;
    if (typeof mod === 'number') {
      value = mod;
    } else if (mod instanceof Signal) {
      value = mod.eval(t);
    } else {
      // It's a phase function
      const phaseSignal = new Signal(() => phase);
      const result = mod(phaseSignal);
      value = result instanceof Signal ? result.eval(t) : result;
    }

    // Warn on NaN (once per stream to avoid spam)
    if (Number.isNaN(value) && !this._warnedNaN) {
      this._warnedNaN = true;
      console.warn(
        `[canyons] Modifier returned NaN in stream "${this.name ?? '(unnamed)'}". ` +
        `Check your signal expressions for division by zero or invalid operations.`
      );
      return defaultVal;
    }

    return Number.isNaN(value) ? defaultVal : value;
  }

  /** Tick the stream at time t, returns current state */
  tick(t: number): StreamState {
    const driverValue = this.driver.eval(t);
    const currentFloor = Math.floor(driverValue);
    const phase = driverValue - currentFloor;
    const index = ((currentFloor % this.values.length) + this.values.length) % this.values.length;
    const note = this.values[index];

    // Check mask
    const masked = this._mask ? this._mask.eval(t) < 0.5 : false;

    // Integer crossing detection
    // Trigger fires when floor changes (forward or backward for scrubbing)
    let trigger = false;
    if (this._lastFloor !== null && currentFloor !== this._lastFloor && !masked) {
      trigger = true;
    }
    this._lastFloor = currentFloor;

    // Calculate velocity
    const velocity = Math.max(0, Math.min(1, this.evalModifier(this._vel, t, phase, DEFAULT_VELOCITY)));

    // Calculate gate
    let gateOpen = true;
    if (this._gate !== null) {
      const phaseSignal = new Signal(() => phase);
      const gateSignal = this._gate(phaseSignal);
      gateOpen = (gateSignal instanceof Signal ? gateSignal.eval(t) : gateSignal) >= 0.5;
    }

    return {
      trigger: trigger && note !== null,
      note,
      velocity,
      phase,
      index,
      gateOpen,
      masked,
      driverValue,
      currentFloor,
    };
  }

  /** Get current pressure value */
  getPressure(t: number, phase: number): number {
    return this.evalModifier(this._pressure, t, phase, 0);
  }

  /** Get current slide value */
  getSlide(t: number, phase: number): number {
    return this.evalModifier(this._slide, t, phase, 0);
  }

  /** Get current bend value */
  getBend(t: number, phase: number): number {
    return this.evalModifier(this._bend, t, phase, 0);
  }
}

/** Create a sequence builder */
export function seq(values: SequenceValue[]): { drive: (signal: Signal) => Stream } {
  return {
    drive(signal: Signal): Stream {
      return new Stream(values, signal);
    },
  };
}
