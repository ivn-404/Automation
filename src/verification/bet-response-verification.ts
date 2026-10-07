/**
 * Balance / win verification from bet response snapshots.
 * Does not execute actions — validates outcomes only.
 */

import type { VerificationKind } from '../core/constants/index.js';
import type {
  BalanceSnapshot,
  BetResponseSnapshot,
  VerificationResult,
  WinSnapshot,
} from '../core/models/index.js';

export function verifyBalanceEquals(
  expected: BalanceSnapshot,
  actual: BalanceSnapshot,
): VerificationResult {
  const passed = expected.amount === actual.amount;
  return {
    kind: 'balance',
    passed,
    message: passed
      ? `Balance matches: ${actual.amount}`
      : `Balance mismatch: expected ${expected.amount}, actual ${actual.amount}`,
    expected: expected.amount,
    actual: actual.amount,
  };
}

export function verifyWinEquals(expected: WinSnapshot, actual: WinSnapshot): VerificationResult {
  const passed = expected.amount === actual.amount;
  return {
    kind: 'win',
    passed,
    message: passed
      ? `Win matches: ${actual.amount}`
      : `Win mismatch: expected ${expected.amount}, actual ${actual.amount}`,
    expected: expected.amount,
    actual: actual.amount,
  };
}

function parseAmount(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Balance amount must be a finite number (network ground truth). */
export function verifyBalanceIsNumeric(balance: BalanceSnapshot | undefined): VerificationResult {
  const amount = parseAmount(balance?.amount);
  const passed = amount !== undefined;
  return {
    kind: 'balance',
    passed,
    message: passed
      ? `Balance is numeric: ${balance!.amount}`
      : `Balance is not a finite number: "${balance?.amount ?? 'undefined'}"`,
    actual: balance?.amount,
  };
}

/** Win amount must be a finite number >= 0. */
export function verifyWinIsNonNegative(win: WinSnapshot | undefined): VerificationResult {
  const amount = parseAmount(win?.amount);
  const passed = amount !== undefined && amount >= 0;
  return {
    kind: 'win',
    passed,
    message: passed
      ? `Win is non-negative: ${win!.amount}`
      : `Win must be a finite number >= 0, got "${win?.amount ?? 'undefined'}"`,
    actual: win?.amount,
  };
}

/**
 * When before-balance is known: after ≈ before - stake + win (float-tolerant).
 * Stake defaults to 0 when unknown (still validates after = before + win).
 */
export function verifyBalanceDelta(options: {
  readonly before: BalanceSnapshot;
  readonly after: BalanceSnapshot;
  readonly win: WinSnapshot;
  readonly stakeAmount?: string;
  readonly tolerance?: number;
}): VerificationResult {
  const before = parseAmount(options.before.amount);
  const after = parseAmount(options.after.amount);
  const win = parseAmount(options.win.amount);
  const stake = parseAmount(options.stakeAmount ?? '0') ?? 0;
  const tolerance = options.tolerance ?? 0.01;

  if (before === undefined || after === undefined || win === undefined) {
    return {
      kind: 'balance',
      passed: false,
      message: 'Cannot verify balance delta — before/after/win not numeric',
      expected: { before: options.before.amount, win: options.win.amount, stake },
      actual: options.after.amount,
    };
  }

  const expectedAfter = before - stake + win;
  const passed = Math.abs(after - expectedAfter) <= tolerance;
  return {
    kind: 'balance',
    passed,
    message: passed
      ? `Balance delta OK: ${before} - ${stake} + ${win} ≈ ${after}`
      : `Balance delta mismatch: expected ≈ ${expectedAfter}, actual ${after}`,
    expected: expectedAfter,
    actual: after,
  };
}

/**
 * Structural checks for a parsed bet response (fields present + optional completed state).
 */
export function verifyBetResponseShape(
  snapshot: BetResponseSnapshot,
  options?: { requireCompleted?: boolean },
): VerificationResult[] {
  const results: VerificationResult[] = [];

  if (snapshot.balance === undefined) {
    results.push({
      kind: 'balance',
      passed: false,
      message: 'Bet response missing balance field',
    });
  } else {
    results.push({
      kind: 'balance',
      passed: true,
      message: `Balance present: ${snapshot.balance.amount}`,
      actual: snapshot.balance.amount,
    });
  }

  if (snapshot.win === undefined) {
    results.push({
      kind: 'win',
      passed: false,
      message: 'Bet response missing totalWin field',
    });
  } else {
    results.push({
      kind: 'win',
      passed: true,
      message: `Total win present: ${snapshot.win.amount}`,
      actual: snapshot.win.amount,
    });
  }

  if (options?.requireCompleted) {
    const kind: VerificationKind = 'balance';
    const passed = snapshot.transactionState === 'completed';
    results.push({
      kind,
      passed,
      message: passed
        ? 'transactionState is completed'
        : `Expected transactionState "completed", got "${snapshot.transactionState ?? 'undefined'}"`,
      expected: 'completed',
      actual: snapshot.transactionState,
    });
  }

  return results;
}

/**
 * Amplify oracle: /bet POST `isEnhancedBet` must match the expected toggle.
 * Missing field fails — do not treat “no field” as pass.
 * Do not use this for Turbo Mode (TM-*) — the lightning control does not set this field.
 */
export function verifyIsEnhancedBet(
  actual: boolean | undefined,
  expected: boolean,
): VerificationResult {
  const passed = actual === expected;
  return {
    kind: 'bet',
    passed,
    message: passed
      ? `Bet request isEnhancedBet=${String(actual)}`
      : `Expected isEnhancedBet=${String(expected)} on /bet request, got ${
          actual === undefined ? 'missing' : String(actual)
        }`,
    expected,
    actual: actual ?? 'missing',
  };
}

/** Stake must be present and > 0 on a paid base-game spin. */
export function verifyStakeIsPositive(
  bet: BetResponseSnapshot['bet'],
): VerificationResult {
  const amount = parseAmount(bet?.amount);
  const passed = amount !== undefined && amount > 0;
  return {
    kind: 'bet',
    passed,
    message: passed
      ? `Stake deducted on spin: ${bet!.amount}`
      : `Expected positive stake on spin, got "${bet?.amount ?? 'undefined'}"`,
    actual: bet?.amount,
  };
}

/**
 * CSF-003 — bet deducted immediately upon spin (same bet response).
 * When before balance is unknown (Sugar Wonderland initialize has no wallet field),
 * verifies stake > 0 and implied pre-spin balance is positive.
 */
export function verifyImpliedPreSpinBalance(
  snapshot: BetResponseSnapshot,
): VerificationResult {
  const after = parseAmount(snapshot.balance?.amount);
  const stake = parseAmount(snapshot.bet?.amount);
  const win = parseAmount(snapshot.win?.amount);

  if (after === undefined || stake === undefined || win === undefined) {
    return {
      kind: 'balance',
      passed: false,
      message: 'Cannot derive implied pre-spin balance — after/stake/win not numeric',
      actual: { after: snapshot.balance?.amount, stake: snapshot.bet?.amount, win: snapshot.win?.amount },
    };
  }

  const impliedBefore = after + stake - win;
  const passed = impliedBefore > 0;
  return {
    kind: 'balance',
    passed,
    message: passed
      ? `Implied pre-spin balance OK: ${impliedBefore} (after ${after} + stake ${stake} - win ${win})`
      : `Implied pre-spin balance not positive: ${impliedBefore}`,
    actual: impliedBefore,
  };
}

export function verifyBetDeductedOnSpin(
  snapshot: BetResponseSnapshot,
  options: {
    beforeBalance?: BalanceSnapshot;
    requireCompleted?: boolean;
    /** Local mock keeps static balance — skip delta when true. */
    skipBalanceDelta?: boolean;
  },
): VerificationResult[] {
  const stakeAmount = snapshot.bet?.amount;
  const results = [
    ...verifyBetResponseShape(snapshot, { requireCompleted: options.requireCompleted }),
    verifyStakeIsPositive(snapshot.bet),
    verifyBalanceIsNumeric(snapshot.balance),
    verifyWinIsNonNegative(snapshot.win),
  ];

  const canVerifyDelta =
    !options.skipBalanceDelta &&
    options.beforeBalance !== undefined &&
    stakeAmount !== undefined &&
    snapshot.balance !== undefined &&
    snapshot.win !== undefined;

  if (canVerifyDelta) {
    results.push(
      verifyBalanceDelta({
        before: options.beforeBalance!,
        after: snapshot.balance!,
        win: snapshot.win!,
        stakeAmount,
      }),
    );
  } else {
    results.push(verifyImpliedPreSpinBalance(snapshot));
  }

  return results;
}

/**
 * Full CSF-001 style checks: shape + numeric balance/win (+ optional delta when before is known).
 */
export function verifyBetSpinOutcome(
  snapshot: BetResponseSnapshot,
  options?: {
    requireCompleted?: boolean;
    beforeBalance?: BalanceSnapshot;
    stakeAmount?: string;
  },
): VerificationResult[] {
  const results = [
    ...verifyBetResponseShape(snapshot, { requireCompleted: options?.requireCompleted }),
    verifyBalanceIsNumeric(snapshot.balance),
    verifyWinIsNonNegative(snapshot.win),
  ];

  // Delta only when stake is explicit — defaulting stake to 0 falsely fails real staging bets.
  if (
    options?.beforeBalance !== undefined &&
    options.stakeAmount !== undefined &&
    snapshot.balance !== undefined &&
    snapshot.win !== undefined
  ) {
    results.push(
      verifyBalanceDelta({
        before: options.beforeBalance,
        after: snapshot.balance,
        win: snapshot.win,
        stakeAmount: options.stakeAmount,
      }),
    );
  }

  return results;
}
