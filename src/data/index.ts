/**
 * Data Sources — bet response, balance, wallet, history, session.
 */
export const DATA_LAYER = 'data' as const;

export { parseBetResponseBody } from './parse-bet-response.js';
export {
  parseBalanceFromBody,
  parseEnhancedBetFromBetRequest,
  parseStakeFromBetRequest,
} from './parse-balance.js';
