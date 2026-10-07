/**
 * Game Driver — iframe/Phaser interaction surface (game-agnostic).
 */

export const DRIVER_LAYER = 'driver' as const;

export { PlaywrightGameDriver, type PlaywrightGameDriverOptions } from './playwright-game-driver.js';
export {
  clickHostWithIndicator,
  installClickTracker,
  isClickTrackerEnabled,
  recordClick,
  refreshClickTracker,
  type ClickRecord,
  type ClickTrackerEnableOptions,
} from './click-tracker.js';
export { GameDriverNotAttachedError } from './errors.js';
export { DEFAULT_DRIVER_TIMEOUT_MS, resolveTimeoutMs } from './wait-options.js';
