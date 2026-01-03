import { describe, it, expect } from 'vitest';
import { Signal, T } from '../signal';

describe('Signal', () => {
  describe('T (global time)', () => {
    it('returns the time passed to eval', () => {
      expect(T.eval(0)).toBe(0);
      expect(T.eval(1)).toBe(1);
      expect(T.eval(5.5)).toBe(5.5);
    });
  });

  describe('arithmetic composition', () => {
    it('mul scales the signal', () => {
      const s = T.mul(2);
      expect(s.eval(0)).toBe(0);
      expect(s.eval(1)).toBe(2);
      expect(s.eval(5)).toBe(10);
    });

    it('div divides the signal', () => {
      const s = T.div(2);
      expect(s.eval(0)).toBe(0);
      expect(s.eval(2)).toBe(1);
      expect(s.eval(10)).toBe(5);
    });

    it('add offsets the signal', () => {
      const s = T.add(1);
      expect(s.eval(0)).toBe(1);
      expect(s.eval(5)).toBe(6);
    });

    it('sub subtracts from the signal', () => {
      const s = T.sub(1);
      expect(s.eval(0)).toBe(-1);
      expect(s.eval(5)).toBe(4);
    });

    it('chains multiple operations', () => {
      // T * 2 + 1
      const s = T.mul(2).add(1);
      expect(s.eval(0)).toBe(1);
      expect(s.eval(1)).toBe(3);
      expect(s.eval(5)).toBe(11);
    });

    it('works with Signal arguments', () => {
      const offset = new Signal((t) => t * 0.1);
      const s = T.add(offset);
      expect(s.eval(10)).toBe(11); // 10 + (10 * 0.1)
    });
  });

  describe('comparison operations', () => {
    it('lt returns 1 when less than', () => {
      const s = T.lt(5);
      expect(s.eval(3)).toBe(1);
      expect(s.eval(5)).toBe(0);
      expect(s.eval(7)).toBe(0);
    });

    it('gt returns 1 when greater than', () => {
      const s = T.gt(5);
      expect(s.eval(3)).toBe(0);
      expect(s.eval(5)).toBe(0);
      expect(s.eval(7)).toBe(1);
    });

    it('lte returns 1 when less than or equal', () => {
      const s = T.lte(5);
      expect(s.eval(3)).toBe(1);
      expect(s.eval(5)).toBe(1);
      expect(s.eval(7)).toBe(0);
    });

    it('gte returns 1 when greater than or equal', () => {
      const s = T.gte(5);
      expect(s.eval(3)).toBe(0);
      expect(s.eval(5)).toBe(1);
      expect(s.eval(7)).toBe(1);
    });

    it('min returns the smaller value', () => {
      const s = T.min(5);
      expect(s.eval(3)).toBe(3);
      expect(s.eval(5)).toBe(5);
      expect(s.eval(7)).toBe(5);
    });

    it('max returns the larger value', () => {
      const s = T.max(5);
      expect(s.eval(3)).toBe(5);
      expect(s.eval(5)).toBe(5);
      expect(s.eval(7)).toBe(7);
    });

    it('clamp restricts to range', () => {
      const s = T.clamp(2, 8);
      expect(s.eval(0)).toBe(2);
      expect(s.eval(5)).toBe(5);
      expect(s.eval(10)).toBe(8);
    });
  });

  describe('modulo (proper negative handling)', () => {
    it('mod wraps positive values', () => {
      const s = T.mod(4);
      expect(s.eval(0)).toBe(0);
      expect(s.eval(1)).toBe(1);
      expect(s.eval(4)).toBe(0);
      expect(s.eval(5)).toBe(1);
      expect(s.eval(7.5)).toBe(3.5);
    });

    it('mod handles negative values correctly', () => {
      // T.sub(1).mod(4) at t=0 should be (-1) mod 4 = 3
      const s = T.sub(1).mod(4);
      expect(s.eval(0)).toBe(3);
      expect(s.eval(1)).toBe(0);
      expect(s.eval(2)).toBe(1);
    });
  });

  describe('shaping functions', () => {
    it('sin applies sine', () => {
      const s = T.sin();
      expect(s.eval(0)).toBeCloseTo(0);
      expect(s.eval(Math.PI / 2)).toBeCloseTo(1);
      expect(s.eval(Math.PI)).toBeCloseTo(0);
    });

    it('cos applies cosine', () => {
      const s = T.cos();
      expect(s.eval(0)).toBeCloseTo(1);
      expect(s.eval(Math.PI / 2)).toBeCloseTo(0);
      expect(s.eval(Math.PI)).toBeCloseTo(-1);
    });

    it('floor truncates down', () => {
      const s = T.floor();
      expect(s.eval(0)).toBe(0);
      expect(s.eval(0.9)).toBe(0);
      expect(s.eval(1.0)).toBe(1);
      expect(s.eval(1.9)).toBe(1);
    });

    it('ceil rounds up', () => {
      const s = T.ceil();
      expect(s.eval(0)).toBe(0);
      expect(s.eval(0.1)).toBe(1);
      expect(s.eval(1.0)).toBe(1);
      expect(s.eval(1.1)).toBe(2);
    });

    it('abs returns absolute value', () => {
      const s = T.sub(5).abs();
      expect(s.eval(3)).toBe(2);
      expect(s.eval(5)).toBe(0);
      expect(s.eval(7)).toBe(2);
    });
  });
});
