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

export {
  classifyFs008Hunt,
  countScatterInArea,
  evaluateFreeSpinRetrigger,
  resolveFs008MaxBuys,
  FS008_DEFAULT_MAX_BUYS,
} from './free-spin-retrigger.js';
export type {
  FreeSpinEntryKind,
  FreeSpinItemObservation,
  FreeSpinRetriggerVerdict,
  Fs008HuntClassification,
  Fs008HuntOutcome,
  RetriggerEvidenceKind,
  RetriggerHit,
} from './free-spin-retrigger.js';

export {
  decideNextBuyBudget,
  isBuyFeatActivationFlag,
  resolveGrossBuyCost,
} from './buy-feature-spend.js';
export type {
  BuyBudgetDecision,
  GrossBuyCost,
  GrossBuyCostSource,
} from './buy-feature-spend.js';

export {
  aggregateAt003Contracts,
  at003ContractVerificationResults,
  at003IncompleteSkipReason,
  buildAt003LiveEvidence,
  classifyAt003Evidence,
  collectAt003DialogEvidence,
  isAt003ErrorDialogIdentity,
  parseBalanceTimeline,
  roundCents,
} from './at003-evidence.js';
export type {
  At003Classification,
  At003ContractReport,
  At003DialogEvidence,
  At003DialogEvidenceSource,
  At003DialogObservationInput,
  At003LiveEvidenceInput,
  At003OverallOutcome,
  At003SessionEvidence,
  At003TimelineRow,
  DialogRecoveryKind,
  HudRecoveryKind,
  ServerContinuityKind,
} from './at003-evidence.js';

