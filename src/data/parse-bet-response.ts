/**
 * Parse a bet/spin HTTP JSON body into BetResponseSnapshot using manifest field paths.
 */

import type { BetResponseSnapshot, NetworkFieldPaths } from '../core/models/index.js';
import { getByPath, toAmountString } from '../shared/json-path.js';

export function parseBetResponseBody(
  body: unknown,
  fields: NetworkFieldPaths,
): BetResponseSnapshot {
  const balanceAmount = toAmountString(getByPath(body, fields.balance));
  const totalWinAmount = toAmountString(getByPath(body, fields.totalWin));

  const transactionStateValue =
    fields.transactionState !== undefined
      ? getByPath(body, fields.transactionState)
      : undefined;

  return {
    raw: body,
    ...(balanceAmount !== undefined
      ? { balance: { amount: balanceAmount, raw: getByPath(body, fields.balance) } }
      : {}),
    ...(totalWinAmount !== undefined
      ? { win: { amount: totalWinAmount, raw: getByPath(body, fields.totalWin) } }
      : {}),
    ...(typeof transactionStateValue === 'string'
      ? { transactionState: transactionStateValue }
      : {}),
  };
}
