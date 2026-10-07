/**
 * Observable wait helpers — timeout is a safety net only.
 */

import type { ObservableWaitOptions } from '../core/models/index.js';

export const DEFAULT_DRIVER_TIMEOUT_MS = 15_000;

export function resolveTimeoutMs(
  options?: ObservableWaitOptions,
  defaultTimeoutMs: number = DEFAULT_DRIVER_TIMEOUT_MS,
): number {
  return options?.timeoutMs ?? defaultTimeoutMs;
}
