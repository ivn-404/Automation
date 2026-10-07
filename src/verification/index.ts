/**
 * Verification layer — validates outcomes; does not execute game actions.
 */
export const VERIFICATION_LAYER = 'verification' as const;

export {
  verifyBalanceDelta,
  verifyBalanceEquals,
  verifyBalanceIsNumeric,
  verifyBetResponseShape,
  verifyBetSpinOutcome,
  verifyIsEnhancedBet,
  verifyWinEquals,
  verifyWinIsNonNegative,
} from './bet-response-verification.js';

export {
  validateBackendFrontendReels,
  learnTemplatesFromSettledSpin,
  parseReelGridFromBetResponse,
  formatReelValidationReport,
  reelReportToVerificationResults,
  loadSymbolTemplates,
  loadCatalogSymbols,
} from './reel/index.js';
export type {
  ReelValidationConfig,
  ReelValidationReport,
  ReelGrid,
  ReelCellComparison,
} from './reel/index.js';

