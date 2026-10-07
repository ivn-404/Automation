/**
 * Game runtime — thin iframe locate/click strategy (Phaser → vision → manifest).
 */

export const RUNTIME_LAYER = 'runtime' as const;

export {
  GameRuntime,
  createGameRuntime,
  type GameRuntimeOptions,
  type LocateSource,
  type RuntimeLocateResult,
  type VisionLocateHook,
  type VisionLocateHookResult,
} from './game-runtime.js';

export {
  inventoryGameIframe,
  formatIframeInventory,
  type IframeInventoryReport,
  type IframeTestSurface,
  type IframeCanvasInfo,
  type IframeDomSample,
  type PhaserControlSample,
} from './iframe-inventory.js';

export {
  listPhaserInteractive,
  listPhaserTexts,
  pickPhaserControl,
  locateControlByPhaser,
  hasPhaserBand,
  type PhaserHit,
  type PhaserLocateResult,
  type PhaserTextHit,
  type PhaserTextLayer,
} from './phaser-locate.js';
