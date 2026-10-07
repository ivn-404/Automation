/**
 * PEN-055 — Racing Cashout against a new StartRound must not settle funds twice.
 *
 * Manual Test Case ID: PEN-055 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: with a card in play, fire Cashout and a fresh StartRound in parallel. Any
 * interleaving must keep the ledger exact — the in-play win is credited at most once and
 * every dealt bet is debited exactly once, with no negative or inflated balance.
 */

import { test } from '../../fixtures/index.js';
import {
  asRounds,
  cashout,
  expectPenChecks,
  invokeParallel,
  penCheck,
  readBalance,
  requireJoined,
  rejectionReason,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-055' as const;

test.describe('PEN — Concurrency & economy integrity', () => {
  test(`${MANUAL_TEST_ID} Cashout/StartRound interleave stays exact`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const initial = session.balance ?? (await readBalance(session)) ?? 0;

      const first = await startRound(session, bet, 0);
      test.skip(!wasDealt(first.round), `StartRound dealt no card: ${rejectionReason(first.completion, first.round) ?? 'unknown'}`);
      let sumBets = first.round?.betAmount ?? 0;
      let sumWins = 0;

      // Race a settle of the in-play card against buying a new one.
      const raced = await invokeParallel(session, [
        { target: 'Cashout', args: [] },
        { target: 'StartRound', args: [bet, 1] },
      ]);
      const cashoutRound = asRounds('Cashout', raced.slice(0, 1))[0];
      const startRoundAgain = asRounds('StartRound', raced.slice(1, 2))[0];
      if (cashoutRound?.round !== undefined && cashoutRound.round.errorCode === null) {
        sumWins += cashoutRound.round.winAmount ?? 0;
      }
      if (wasDealt(startRoundAgain?.round)) {
        sumBets += startRoundAgain?.round?.betAmount ?? 0;
      }

      // Drain anything still in play.
      for (let i = 0; i < 3; i += 1) {
        const settled = await cashout(session);
        if (settled.completion.error !== undefined || settled.round === undefined || settled.round.errorCode !== null) {
          break;
        }
        sumWins += settled.round.winAmount ?? 0;
      }

      const finalBalance = (await readBalance(session)) ?? Number.NaN;
      const expected = Math.round((initial - sumBets + sumWins) * 100) / 100;
      const actual = Math.round(finalBalance * 100) / 100;

      await expectPenChecks(
        testInfo,
        [
          penCheck(finalBalance >= -0.0001, `Balance never went negative (${actual})`, '>= 0', actual),
          penCheck(
            Number.isFinite(actual) && Math.abs(actual - expected) < 0.01,
            `Ledger balances: ${initial} − Σbets ${sumBets.toFixed(2)} + Σwins ${sumWins.toFixed(2)} = ${expected} (actual ${actual})`,
            expected,
            actual,
          ),
        ],
        { initial, sumBets, sumWins, expected, actual, raced },
      );
    } finally {
      session.client.close();
    }
  });
});
