/**
 * SGAP public framework entry point.
 */

export const SGAP_VERSION = '0.1.0';

export * from './core/constants/index.js';
export * from './core/models/index.js';
export * from './core/contracts/index.js';

export {
  PLATFORM_LAYER,
  GAME_MANIFEST_SCHEMA_VERSION,
  GameManifestValidationError,
  parseGameManifest,
  FileGameManifestLoader,
  GameManifestNotFoundError,
  defaultManifestsDir,
  ENVIRONMENT_SCHEMA_VERSION,
  EnvironmentValidationError,
  parseEnvironmentConfig,
  FileEnvironmentLoader,
  EnvironmentNotFoundError,
  defaultEnvironmentsDir,
  PlaywrightPlatform,
  PlatformConfigurationError,
} from './platform/index.js';
export type {
  FileGameManifestLoaderOptions,
  FileEnvironmentLoaderOptions,
  PlaywrightPlatformOptions,
} from './platform/index.js';

export {
  DRIVER_LAYER,
  PlaywrightGameDriver,
  GameDriverNotAttachedError,
  DEFAULT_DRIVER_TIMEOUT_MS,
  resolveTimeoutMs,
} from './driver/index.js';
export type { PlaywrightGameDriverOptions } from './driver/index.js';
export {
  CONTROLLERS_LAYER,
  ControllerRegistry,
  ControllerAlreadyRegisteredError,
  ControllerDisabledError,
  ControllerNotRegisteredError,
  SpinController,
} from './controllers/index.js';
export type { SpinControllerOptions } from './controllers/index.js';
export { CONTROLLER_REGISTRY } from './controllers/registry/index.js';
export { EVENTS_LAYER } from './events/index.js';
export { EVENT_REGISTRY } from './events/registry/index.js';
export { DATA_LAYER, parseBetResponseBody } from './data/index.js';
export {
  VERIFICATION_LAYER,
  verifyBalanceDelta,
  verifyBalanceEquals,
  verifyBalanceIsNumeric,
  verifyBetResponseShape,
  verifyBetSpinOutcome,
  verifyIsEnhancedBet,
  verifyWinEquals,
  verifyWinIsNonNegative,
} from './verification/index.js';
export {
  NETWORK_LAYER,
  BetResponseWatcher,
  matchesUrlPattern,
} from './network/index.js';
export type { BetResponseWatcherOptions } from './network/index.js';
export { STATE_LAYER } from './state/index.js';
export { READINESS_LAYER } from './readiness/index.js';
export {
  REPORTING_LAYER,
  InMemoryExecutionTracker,
  JsonFileReporter,
} from './reporting/index.js';
export type { JsonFileReporterOptions } from './reporting/index.js';
export { TRACEABILITY_LAYER } from './traceability/index.js';
export { UI_LAYER } from './ui/index.js';
export {
  UiRegistry,
  LocatorKeyNotFoundError,
  UiRegistryNotConfiguredError,
} from './ui/index.js';
export type { ResolvedLocator } from './ui/index.js';
export { UI_REGISTRY } from './ui/registry/index.js';
export { SHARED_LAYER, getByPath, toAmountString } from './shared/index.js';
export {
  EYE_LAYER,
  clearInterferingScreens,
  gateCanvasIntent,
  intentFromAction,
  isEyeEnabled,
  loadEyeCatalog,
  IntentNotReadyError,
} from './eye/index.js';
export type {
  ClearInterferingScreensOptions,
  EyeCatalog,
  EyeIntent,
  EyeObservation,
  EyeScreenDefinition,
} from './eye/index.js';
export {
  RUNTIME_LAYER,
  GameRuntime,
  createGameRuntime,
  inventoryGameIframe,
  formatIframeInventory,
  locateControlByPhaser,
  listPhaserInteractive,
  pickPhaserControl,
} from './runtime/index.js';
export type {
  GameRuntimeOptions,
  LocateSource,
  RuntimeLocateResult,
  VisionLocateHook,
  VisionLocateHookResult,
  IframeInventoryReport,
  IframeTestSurface,
  PhaserHit,
  PhaserLocateResult,
} from './runtime/index.js';
