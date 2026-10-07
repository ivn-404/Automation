/**
 * Backend vs frontend reel / symbol validation.
 */

export type {
  ReelValidationConfig,
  ReelValidationReport,
  ReelGrid,
  ReelCellComparison,
  ReelCell,
  ReelCellCompareResult,
} from './types.js';

export {
  parseReelGridFromBetResponse,
  buildReelGridFromMatrix,
  resolveReelAreaMatrix,
} from './parse-reel-area.js';
export {
  formatReelValidationReport,
  compareBackendFrontendReels,
  reelReportToVerificationResults,
} from './compare-reels.js';
export { loadSymbolTemplates, loadCatalogSymbols } from './symbol-catalog.js';
export { loadPackageCatalog, displaySymbolName } from './package-catalog.js';
export type { PackageSymbolCatalog } from './package-catalog.js';
export { readBackendSpin, formatBackendSpinGrid, visualRowMajorIds } from './backend-reader.js';
export type {
  BackendSpinRead,
  ReadBackendSpinOptions,
  BackendBoardView,
  BackendSpinGroup,
  BackendTumbleStep,
} from './backend-reader.js';
export { attachBackendReaderCapture, labelBackendReaderEvent, isImmediateRestartSpec } from './backend-reader-capture.js';
export type {
  AttachBackendReaderCaptureOptions,
  BackendReaderEventLabel,
  ShotQuality,
  ReaderStepKind,
} from './backend-reader-capture.js';
export { readFrontendReelGrid, captureCanvasRgba, learnLiveSymbolTemplates } from './canvas-reel-reader.js';
export {
  validateBackendFrontendReels,
  validateSettledSpinLeaveOneOut,
  learnTemplatesFromSettledSpin,
} from './validate.js';
