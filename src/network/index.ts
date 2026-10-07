/**
 * Network layer — request/response capture supporting data and verification.
 */
export const NETWORK_LAYER = 'network' as const;

export {
  BetResponseWatcher,
  isBuyPurchaseRequest,
  isBuyPurchaseResponse,
  matchesUrlPattern,
  type BetResponseWatcherOptions,
} from './bet-response-watcher.js';
export {
  RoundTracker,
  describeRound,
  roundTrackerFor,
  trackRounds,
  untrackRounds,
  type OpenRound,
  type RoundWaitOptions,
  type RoundWaitOutcome,
  type RoundWaitResult,
} from './round-tracker.js';
export {
  ScratchHubServerError,
  ScratchHubWatcher,
  parseRound as parseScratchRound,
  type ScratchCardCell,
  type ScratchCardSnapshot,
  type ScratchHubWatcherOptions,
  type ScratchPayTableEntry,
  type ScratchRoundSnapshot,
} from './scratch-hub-watcher.js';
export {
  ScratchHubClient,
  decodeAccessToken,
  type HubCompletion,
  type InvokeOptions,
} from './scratch-hub-client.js';
