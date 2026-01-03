/**
 * Evaluator — Sandboxed execution of user code with canyons primitives.
 */

import {
  T, seq, _, engine, midi, stop, hush,
  bpm, hz, swell, attack, decay, legato, stacc, tenuto,
  breath, vibrato, crescendo, decrescendo, onBeat, offBeat
} from './index';

export interface EvalResult {
  success: boolean;
  error?: Error;
  values?: Record<string, unknown>;
}

/** Extract const names from code for signal detection */
export function extractConstNames(code: string): string[] {
  const names: string[] = [];
  const regex = /const\s+(\w+)\s*=/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/** Wrap code to return all const values for signal detection */
function wrapCodeForSignalDetection(code: string, constNames: string[]): string {
  if (constNames.length === 0) return code;
  const returnObj = constNames.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ');
  return `${code}\nreturn { ${returnObj} };`;
}

/**
 * Evaluate user code with canyons primitives in scope.
 * Uses hot reload to smoothly update running streams.
 */
export function evaluateCode(code: string): EvalResult {
  try {
    // Hot reload: mark start of eval cycle
    engine.beginHotReload();

    // Extract const names for signal detection
    const constNames = extractConstNames(code);
    const wrappedCode = wrapCodeForSignalDetection(code, constNames);

    // Create a function with all canyons primitives in scope
    const fn = new Function(
      'T', 'seq', '_', 'engine', 'midi', 'stop', 'hush',
      'bpm', 'hz', 'swell', 'attack', 'decay', 'legato', 'stacc', 'tenuto',
      'breath', 'vibrato', 'crescendo', 'decrescendo', 'onBeat', 'offBeat',
      wrappedCode
    );

    const result = fn(
      T, seq, _, engine, midi, stop, hush,
      bpm, hz, swell, attack, decay, legato, stacc, tenuto,
      breath, vibrato, crescendo, decrescendo, onBeat, offBeat
    );

    // Hot reload: remove streams that weren't re-registered
    engine.endHotReload();

    return {
      success: true,
      values: result && typeof result === 'object' ? result : undefined,
    };
  } catch (e) {
    // End hot reload cycle even on error
    engine.endHotReload();

    return {
      success: false,
      error: e as Error,
    };
  }
}

/**
 * Evaluate code and fall back to last good code on error.
 * Returns the result of the successful evaluation.
 */
export function evaluateWithFallback(
  code: string,
  lastGoodCode: string
): { result: EvalResult; usedFallback: boolean } {
  const result = evaluateCode(code);

  if (result.success) {
    return { result, usedFallback: false };
  }

  // Error occurred - try to restore last good code
  const fallbackResult = evaluateCode(lastGoodCode);

  return {
    result: { ...result, values: fallbackResult.values },
    usedFallback: true,
  };
}
