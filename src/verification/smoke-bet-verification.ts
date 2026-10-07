/**
 * Smoke: bet spin outcome verification helpers.
 * Run: node dist/verification/smoke-bet-verification.js
 */
import {
  verifyBalanceDelta,
  verifyBetSpinOutcome,
  verifyIsEnhancedBet,
  verifyWinIsNonNegative,
} from './bet-response-verification.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const snapshot = {
  raw: {},
  balance: { amount: '100' },
  win: { amount: '10' },
  transactionState: 'completed' as const,
};

const results = verifyBetSpinOutcome(snapshot, {
  requireCompleted: true,
  beforeBalance: { amount: '95' },
  stakeAmount: '5',
});

assert(results.every((result) => result.passed), results.map((r) => r.message).join('; '));

const noDeltaWithoutStake = verifyBetSpinOutcome(snapshot, {
  requireCompleted: true,
  beforeBalance: { amount: '95' },
});
assert(
  noDeltaWithoutStake.every((result) => result.passed),
  'delta must not run without explicit stake',
);
assert(
  !noDeltaWithoutStake.some((result) => result.message.includes('Balance delta')),
  'unexpected delta check without stake',
);

const badWin = verifyWinIsNonNegative({ amount: '-1' });
assert(!badWin.passed, 'expected negative win to fail');

const delta = verifyBalanceDelta({
  before: { amount: '100' },
  after: { amount: '90' },
  win: { amount: '0' },
  stakeAmount: '10',
});
assert(delta.passed, delta.message);

const amplifyOn = verifyIsEnhancedBet(true, true);
assert(amplifyOn.passed, amplifyOn.message);
const amplifyOff = verifyIsEnhancedBet(false, true);
assert(!amplifyOff.passed, 'expected missing amplify (isEnhancedBet=false) to fail');
const amplifyMissing = verifyIsEnhancedBet(undefined, true);
assert(!amplifyMissing.passed, 'expected missing isEnhancedBet to fail');

console.log('verification smoke OK');
