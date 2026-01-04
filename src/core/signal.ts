/**
 * Signal — A function of time that can be composed and transformed.
 *
 * This is the core primitive of canyons. Everything flows from signals.
 */

import type { SignalFn } from './types';

export type { SignalFn };

export class Signal {
  private _fn: SignalFn;

  constructor(fn: SignalFn) {
    this._fn = fn;
  }

  /** Evaluate the signal at time t */
  eval(t: number): number {
    return this._fn(t);
  }

  /** Helper: resolve number | Signal to a value at time t */
  private static toVal(x: number | Signal, t: number): number {
    return x instanceof Signal ? x.eval(t) : x;
  }

  // --- Arithmetic ---

  mul(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) * Signal.toVal(x, t));
  }

  div(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) / Signal.toVal(x, t));
  }

  add(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) + Signal.toVal(x, t));
  }

  sub(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) - Signal.toVal(x, t));
  }

  // --- Shaping ---

  mod(x: number | Signal): Signal {
    return new Signal((t) => {
      const val = this.eval(t);
      const m = Signal.toVal(x, t);
      return ((val % m) + m) % m; // proper modulo for negatives
    });
  }

  sin(): Signal {
    return new Signal((t) => Math.sin(this.eval(t)));
  }

  cos(): Signal {
    return new Signal((t) => Math.cos(this.eval(t)));
  }

  floor(): Signal {
    return new Signal((t) => Math.floor(this.eval(t)));
  }

  ceil(): Signal {
    return new Signal((t) => Math.ceil(this.eval(t)));
  }

  abs(): Signal {
    return new Signal((t) => Math.abs(this.eval(t)));
  }

  // --- Comparison ---

  lt(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) < Signal.toVal(x, t) ? 1 : 0);
  }

  gt(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) > Signal.toVal(x, t) ? 1 : 0);
  }

  lte(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) <= Signal.toVal(x, t) ? 1 : 0);
  }

  gte(x: number | Signal): Signal {
    return new Signal((t) => this.eval(t) >= Signal.toVal(x, t) ? 1 : 0);
  }

  min(x: number | Signal): Signal {
    return new Signal((t) => Math.min(this.eval(t), Signal.toVal(x, t)));
  }

  max(x: number | Signal): Signal {
    return new Signal((t) => Math.max(this.eval(t), Signal.toVal(x, t)));
  }

  // --- Clamping shorthand ---

  clamp(lo: number, hi: number): Signal {
    return this.max(lo).min(hi);
  }
}

/** Global time signal (seconds since start) */
export const T = new Signal((t) => t);
