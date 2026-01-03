import { describe, it, expect, beforeEach } from 'vitest';
import { Stream, seq, _ } from '../stream';
import { Signal, T } from '../signal';

describe('Stream', () => {
  describe('integer crossing triggers', () => {
    it('triggers once per integer crossing', () => {
      const driver = T.mul(10); // 10 crossings per second
      const stream = new Stream([60, 64, 67], driver);

      const triggers: number[] = [];

      // Advance from t=0 to t=0.35 in small steps
      // Should cross integers 1, 2, 3
      for (let t = 0; t <= 0.35; t += 0.01) {
        const state = stream.tick(t);
        if (state.trigger) {
          triggers.push(state.currentFloor);
        }
      }

      expect(triggers).toEqual([1, 2, 3]);
    });

    it('does not trigger on first tick (no previous state)', () => {
      const driver = T.mul(10);
      const stream = new Stream([60, 64, 67], driver);

      // First tick at t=0.05 (floor=0) should not trigger
      const state = stream.tick(0.05);
      expect(state.trigger).toBe(false);
    });

    it('triggers when crossing from any integer to the next', () => {
      const driver = T.mul(10);
      const stream = new Stream([60, 64, 67], driver);

      // Set up state at t=0.05 (floor=0)
      stream.tick(0.05);

      // Jump to t=0.15 (floor=1) - should trigger
      const state = stream.tick(0.15);
      expect(state.trigger).toBe(true);
      expect(state.currentFloor).toBe(1);
    });

    it('does not double-trigger when staying at same floor', () => {
      const driver = T.mul(10);
      const stream = new Stream([60, 64, 67], driver);

      const triggers: number[] = [];

      // Stay within floor 1 the entire time (1.0 <= driver < 2.0)
      // t=0.10 to t=0.19 all have floor=1
      stream.tick(0.05); // setup at floor 0
      stream.tick(0.10); // cross to floor 1 - triggers

      // Multiple ticks within floor 1 should not trigger again
      for (const t of [0.11, 0.12, 0.13, 0.15, 0.18, 0.19]) {
        const state = stream.tick(t);
        if (state.trigger) {
          triggers.push(state.currentFloor);
        }
      }

      // No additional triggers while staying in floor 1
      expect(triggers).toEqual([]);
    });

    it('triggers on each direction change when scrubbing', () => {
      const driver = T.mul(10);
      const stream = new Stream([60, 64, 67], driver);

      const triggers: number[] = [];

      // Scrub back and forth across boundary
      const times = [0.05, 0.15, 0.05, 0.15]; // floor 0 -> 1 -> 0 -> 1
      for (const t of times) {
        const state = stream.tick(t);
        if (state.trigger) {
          triggers.push(state.currentFloor);
        }
      }

      // Each crossing triggers (this is correct behavior for scrubbing)
      expect(triggers).toEqual([1, 0, 1]);
    });
  });

  describe('seek and resume', () => {
    it('does not double-trigger when scrubbing backward then forward', () => {
      const driver = T.mul(10);
      const stream = new Stream([60, 64, 67], driver);

      const triggers: number[] = [];

      // Go forward to floor=2
      stream.tick(0.05);  // floor=0
      stream.tick(0.15);  // floor=1, trigger
      stream.tick(0.25);  // floor=2, trigger

      // Scrub backward to floor=1
      const backState = stream.tick(0.15);
      if (backState.trigger) triggers.push(backState.currentFloor);

      // Go forward again to floor=2
      const fwdState = stream.tick(0.25);
      if (fwdState.trigger) triggers.push(fwdState.currentFloor);

      // Should trigger once for each crossing (backward triggers too)
      // The key is we don't get stuck or double-trigger
      expect(triggers.length).toBe(2); // 1 when going back, 2 when going forward
    });
  });

  describe('sequence indexing', () => {
    it('cycles through values based on floor mod length', () => {
      const driver = T; // 1 crossing per second
      const stream = new Stream([60, 64, 67], driver);

      // At floor 0 -> index 0 -> note 60
      expect(stream.tick(0.5).note).toBe(60);

      // At floor 1 -> index 1 -> note 64
      expect(stream.tick(1.5).note).toBe(64);

      // At floor 2 -> index 2 -> note 67
      expect(stream.tick(2.5).note).toBe(67);

      // At floor 3 -> index 0 (wraps) -> note 60
      expect(stream.tick(3.5).note).toBe(60);
    });

    it('handles rest values (null)', () => {
      const driver = T;
      const stream = new Stream([60, _, 67], driver);

      // At floor 1 -> index 1 -> rest (null)
      const state = stream.tick(1.5);
      expect(state.note).toBe(null);

      // Trigger should be false for rest even if we crossed an integer
      stream.tick(0.5); // setup
      const triggerState = stream.tick(1.5);
      expect(triggerState.trigger).toBe(false);
    });
  });

  describe('mask behavior', () => {
    it('suppresses trigger when mask < 0.5', () => {
      const driver = T.mul(10);
      // Mask is 0 (< 0.5) for t <= 0.2, then 1 for t > 0.2
      const mask = T.mul(5).gt(1); // 1 when t*5 > 1, i.e., t > 0.2
      const stream = new Stream([60, 64, 67], driver).mask(mask);

      const triggers: number[] = [];

      // Use explicit times to avoid floating point issues
      const times = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45];
      for (const t of times) {
        const state = stream.tick(t);
        if (state.trigger) {
          triggers.push(state.currentFloor);
        }
      }

      // Crossings at t=0.1 (floor 1) and t=0.2 (floor 2) should be masked
      // Crossings at t=0.3 (floor 3) and t=0.4 (floor 4) should trigger
      expect(triggers).toEqual([3, 4]);
    });

    it('sets masked flag correctly', () => {
      const driver = T;
      const mask = new Signal(() => 0); // always masked
      const stream = new Stream([60], driver).mask(mask);

      const state = stream.tick(0.5);
      expect(state.masked).toBe(true);
    });
  });

  describe('gate vs mask', () => {
    it('gate controls gateOpen but does not prevent trigger', () => {
      const driver = T.mul(10);
      // Gate opens for first 30% of each period
      const stream = new Stream([60, 64, 67], driver)
        .gate((p) => p.lt(0.3));

      // Setup
      stream.tick(0.05);

      // Cross to floor 1 at phase 0.5 (gate should be closed)
      const state = stream.tick(0.15);

      expect(state.trigger).toBe(true); // trigger still fires
      expect(state.gateOpen).toBe(false); // but gate is closed
    });

    it('mask prevents trigger entirely', () => {
      const driver = T.mul(10);
      const mask = new Signal(() => 0); // always masked
      const stream = new Stream([60, 64, 67], driver).mask(mask);

      stream.tick(0.05);
      const state = stream.tick(0.15);

      expect(state.trigger).toBe(false); // no trigger when masked
    });
  });

  describe('hot reload state transfer', () => {
    it('preserves _lastFloor across transfer', () => {
      const driver = T.mul(10);
      const stream1 = new Stream([60, 64, 67], driver);

      // Advance stream1 to floor=2
      stream1.tick(0.05);
      stream1.tick(0.15);
      stream1.tick(0.25);

      // Create new stream and transfer state
      const stream2 = new Stream([72, 76, 79], driver);
      stream2.transferStateFrom(stream1);

      // Next tick should not trigger (same floor)
      const state = stream2.tick(0.28);
      expect(state.trigger).toBe(false);

      // Tick to next floor should trigger
      const nextState = stream2.tick(0.35);
      expect(nextState.trigger).toBe(true);
      expect(nextState.currentFloor).toBe(3);
    });
  });

  describe('phase calculation', () => {
    it('phase is fractional part of driver value', () => {
      const driver = T.mul(10);
      const stream = new Stream([60], driver);

      // At t=0.15, driver=1.5, phase=0.5
      const state = stream.tick(0.15);
      expect(state.phase).toBeCloseTo(0.5);

      // At t=0.23, driver=2.3, phase=0.3
      const state2 = stream.tick(0.23);
      expect(state2.phase).toBeCloseTo(0.3);
    });
  });

  describe('velocity modifier', () => {
    it('applies constant velocity', () => {
      const driver = T;
      const stream = new Stream([60], driver).vel(0.5);

      const state = stream.tick(0.5);
      expect(state.velocity).toBeCloseTo(0.5);
    });

    it('clamps velocity to 0-1 range', () => {
      const driver = T;
      const streamHigh = new Stream([60], driver).vel(1.5);
      const streamLow = new Stream([60], driver).vel(-0.5);

      expect(streamHigh.tick(0.5).velocity).toBe(1);
      expect(streamLow.tick(0.5).velocity).toBe(0);
    });
  });

  describe('seq builder', () => {
    it('creates a stream with drive()', () => {
      const stream = seq([60, 64, 67]).drive(T);

      expect(stream).toBeInstanceOf(Stream);
      expect(stream.tick(0.5).note).toBe(60);
    });
  });
});
