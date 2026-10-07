/**
 * Parse initialize (or any wallet-bearing) JSON into a balance snapshot using manifest fields.
 */

import type { BalanceSnapshot, NetworkFieldPaths } from '../core/models/index.js';
import { getByPath, toAmountString } from '../shared/json-path.js';

export function parseBalanceFromBody(
  body: unknown,
  fields: NetworkFieldPaths,
): BalanceSnapshot | undefined {
  const amount = toAmountString(getByPath(body, fields.balance));
  if (amount === undefined) {
    return undefined;
  }
  return { amount, raw: getByPath(body, fields.balance) };
}

/** Common DiJoker / slots bet request stake field names. */
const STAKE_CANDIDATE_PATHS = [
  'bet',
  'amount',
  'stake',
  'totalBet',
  'betAmount',
  'wager',
] as const;

export function parseStakeFromBetRequest(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }

  for (const path of STAKE_CANDIDATE_PATHS) {
    const amount = toAmountString(getByPath(body, path));
    if (amount !== undefined) {
      return amount;
    }
  }
  return undefined;
}

/**
 * Amplify flag on the /bet POST body (`isEnhancedBet`).
 * Missing or non-boolean is undefined — callers must fail closed, not skip.
 * Turbo lightning is not this field (no turbo key exists on Package 1 /bet).
 */
export function parseEnhancedBetFromBetRequest(body: unknown): boolean | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as { isEnhancedBet?: unknown }).isEnhancedBet;
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === 'true') {
    return true;
  }
  if (value === 0 || value === 'false') {
    return false;
  }
  return undefined;
}
