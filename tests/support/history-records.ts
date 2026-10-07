/**
 * Walk spin / initialize / history JSON for amounts that should match a bet record.
 */

const HISTORY_URL_RE = /history|histories|rounds|records|live[-_]?history/i;
const SKIP_URL_RE = /\/slots\/(bet|buy|initialize)\b/i;

export function isHistoryLikeUrl(url: string): boolean {
  return HISTORY_URL_RE.test(url) && !SKIP_URL_RE.test(url);
}

export function amountsNear(left: number, right: number, epsilon = 0.02): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= epsilon;
}

function pushAmount(bucket: number[], value: unknown): void {
  const n = Number(value);
  if (Number.isFinite(n)) {
    bucket.push(n);
  }
}

/** Collect balance-like and win-like numbers from a nested payload. */
export function collectRecordAmounts(body: unknown): {
  readonly balances: readonly number[];
  readonly wins: readonly number[];
} {
  const balances: number[] = [];
  const wins: number[] = [];

  const visit = (value: unknown, key?: string): void => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, key);
      }
      return;
    }
    if (typeof value !== 'object') {
      if (key === 'balance' || key === 'lastBalance' || key === 'wallet') {
        pushAmount(balances, value);
      }
      if (
        key === 'totalWin' ||
        key === 'win' ||
        key === 'lastWin' ||
        key === 'amount' ||
        key === 'payout'
      ) {
        pushAmount(wins, value);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [nextKey, nextValue] of Object.entries(record)) {
      if (
        nextKey === 'balance' ||
        nextKey === 'lastBalance' ||
        nextKey === 'walletBalance'
      ) {
        if (typeof nextValue === 'object' && nextValue !== null && 'amount' in nextValue) {
          pushAmount(balances, (nextValue as { amount: unknown }).amount);
        } else {
          pushAmount(balances, nextValue);
        }
      }
      if (
        nextKey === 'totalWin' ||
        nextKey === 'lastWin' ||
        nextKey === 'winAmount' ||
        nextKey === 'payout'
      ) {
        pushAmount(wins, nextValue);
      }
      if (nextKey === 'win' && (typeof nextValue === 'number' || typeof nextValue === 'string')) {
        pushAmount(wins, nextValue);
      }
      visit(nextValue, nextKey);
    }
  };

  visit(body);
  return { balances, wins };
}

export function payloadMatchesSpin(
  body: unknown,
  balance: number,
  win: number,
): boolean {
  const { balances, wins } = collectRecordAmounts(body);
  const balanceHit = balances.some((entry) => amountsNear(entry, balance));
  const winHit = wins.some((entry) => amountsNear(entry, win));
  return balanceHit || winHit;
}
