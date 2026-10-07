/**
 * Platform layer — browser/session bootstrap and host navigation entry.
 * Replaces classic Page Objects for shell/host concerns.
 */

export const PLATFORM_LAYER = 'platform' as const;

export * from './manifest/index.js';
export * from './environment/index.js';
export {
  PlaywrightPlatform,
  type PlaywrightPlatformOptions,
} from './playwright-platform.js';
export {
  primeCanvasSession,
  clearCanvasOverlays,
  clearNonGridOverlays,
  settleCanvasToBaseGame,
  drainLeftoverFeatureSpins,
  freeSpinItemsRemaining,
  getFreeSpinItems,
  isFreeSpinBundleComplete,
  markSpinTriggered,
  hasSpinTrigger,
  resetSpinTrigger,
  spamClickGridOverlays,
  spamClickSkip,
  type CanvasSessionPrimerOptions,
  type ClearCanvasOverlaysOptions,
} from './canvas-session-primer.js';
export { PlatformConfigurationError } from './errors.js';
export {
  PORTRAIT_ASPECT,
  WINDOW_CHROME,
  fitPortraitSize,
  innerViewportForWindow,
  parseWxH,
} from './game-view-layout.js';
