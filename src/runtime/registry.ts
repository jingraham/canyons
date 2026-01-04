/**
 * Registry — Stream registration pattern.
 *
 * This module provides the registry pattern that allows streams to register
 * themselves with the engine without creating a circular dependency.
 *
 * The registry is set by the evaluator before running user code, allowing
 * .as() calls to register streams with the engine.
 */

import type { StreamRegistry } from '../core/types';

/** Current active registry (set before evaluating user code) */
let currentRegistry: StreamRegistry | null = null;

/** Set the active stream registry (called before evaluating user code) */
export function setRegistry(registry: StreamRegistry | null): void {
  currentRegistry = registry;
}

/** Get the current registry */
export function getRegistry(): StreamRegistry | null {
  return currentRegistry;
}
