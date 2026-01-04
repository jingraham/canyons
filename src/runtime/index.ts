/**
 * Runtime — User code execution environment for canyons.
 *
 * This module handles:
 * - Code evaluation with sandboxing
 * - Standard prelude (composer helpers)
 * - Stream registration
 */

export { setRegistry, getRegistry } from './registry';
export { evaluateCode, evaluateWithFallback, extractConstNames } from './evaluator';
export type { EvalResult } from './evaluator';

export {
  bpm,
  hz,
  swell,
  attack,
  decay,
  legato,
  stacc,
  tenuto,
  breath,
  vibrato,
  crescendo,
  decrescendo,
  onBeat,
  offBeat,
} from './prelude';
