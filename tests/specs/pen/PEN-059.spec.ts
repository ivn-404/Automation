/**
 * PEN-059 — Boundary bets are validated server-side with no rounding leak.
 *
 * Manual Test Case ID: PEN-059 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: zero, exactly-balance, one-over-balance, and high-precision fractional bets
 * must each be handled server-side — rejected cleanly with the balance untouched, or
 * dealt with an exact debit that never rounds in the player's favor.
 */

import { test } from '../../fixtures/index.js';
import type { PenSession, HubRound } from '../../support/pen-hub.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  rejectionReason,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-059' as const;

interface Probe {
  readonly label: string;
  readonly bet: number;
  readonly before: number;
  readonly after: number;
  readonly dealt: boolean;
  readonly round: HubRound;
}

async function probeBet(session: PenSession, label: string, bet: number): Promise<Probe> {
  const before = (await readBalance(session)) ?? 0;
  const round = await startRound(session, bet, 0);
  const dealt = wasDealt(round.round);
  if (dealt) {
    await cashout(session);
  }
  const after = (await readBalance(session)) ?? before;
  return { label, bet, before, after, dealt, round };
}

test.describe('PEN — Economy edge values', () => {
  test(`${MANUAL_TEST_ID} boundary bets validated server-side`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const advertisesMaxBet = typeof (session.config?.raw as { maxBet?: unknown } | undefined)?.maxBet === 'number';
      const balance = session.balance ?? (await readBalance(session)) ?? 0;

      const zero = await probeBet(session, 'zero', 0);
      const overBalance = await probeBet(session, 'one-over-balance', balance + 1);
      const exactBalance = await probeBet(session, 'exactly-balance', balance);
      const fractional = await probeBet(session, 'high-precision-fractional', minBet + 0.0000001);

      const checks = [
        penCheck(
          !zero.dealt,
          `Zero bet rejected (${rejectionReason(zero.round.completion, zero.round.round) ?? 'DEALT a free card!'})`,
        ),
        penCheck(
          !overBalance.dealt && Math.abs(overBalance.after - overBalance.before) < 0.01,
          `Bet above balance rejected, balance untouched (${overBalance.before} → ${overBalance.after})`,
        ),
        penCheck(
          !exactBalance.dealt,
          exactBalance.dealt
            ? `NO MAX-BET CEILING — full-balance bet of ${exactBalance.round.round?.betAmount} accepted and dealt (server config advertises ${advertisesMaxBet ? 'a maxBet that was not enforced' : 'no maxBet at all'})`
            : `Full-balance bet refused (${rejectionReason(exactBalance.round.completion, exactBalance.round.round)})`,
        ),
        penCheck(
          !fractional.dealt || (fractional.round.round?.betAmount ?? 0) >= minBet - 0.0001,
          `Fractional bet not rounded in player's favor (dealt bet ${fractional.round.round?.betAmount ?? 'none'}, requested ${minBet + 0.0000001})`,
        ),
      ];

      await expectPenChecks(testInfo, checks, { zero, overBalance, exactBalance, fractional });
    } finally {
      session.client.close();
    }
  });
});
