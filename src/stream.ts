/**
 * Stream — A sequence of values driven by a signal.
 *
 * Discrete events emerge from integer crossings of the driver signal.
 */

import { Signal } from './signal';
import { engine } from './engine';

/** Rest marker — null values in sequences are skipped */
export const _ = null;

export type NoteValue = number | null;
export type SequenceValue = NoteValue | NoteValue[]; // single note, rest, or chord

/** Function that receives phase signal and returns a signal */
export type PhaseFunction = (phase: Signal) => Signal | number;

/** Modifier value: constant, signal, or phase function */
export type ModifierValue = number | Signal | PhaseFunction;

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
  private _noteOnTime: number | null = null;

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

  /** Register this stream with the engine */
  as(name: string): this {
    this.name = name;
    engine.register(name, this);
    return this;
  }

  /** Get the instrument name */
  get instrument(): string {
    return this._inst;
  }

  /** Reset state (called on engine start) */
  reset(): void {
    this._lastFloor = null;
    this._noteOnTime = null;
  }

  /** Evaluate a modifier value at time t with given phase */
  private evalModifier(mod: ModifierValue | null, t: number, phase: number, defaultVal: number): number {
    if (mod === null) return defaultVal;
    if (typeof mod === 'number') return mod;
    if (mod instanceof Signal) return mod.eval(t);
    // It's a phase function
    const phaseSignal = new Signal(() => phase);
    const result = mod(phaseSignal);
    return result instanceof Signal ? result.eval(t) : result;
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

    // Integer crossing detection with hysteresis
    // Trigger fires when floor INCREASES (not on decrease)
    let trigger = false;
    if (this._lastFloor !== null && currentFloor > this._lastFloor && !masked) {
      trigger = true;
      this._noteOnTime = t;
    }
    this._lastFloor = currentFloor;

    // Calculate velocity
    const velocity = Math.max(0, Math.min(1, this.evalModifier(this._vel, t, phase, 0.7)));

    // Calculate gate
    let gateOpen = true;
    if (this._gate !== null && this._noteOnTime !== null) {
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
