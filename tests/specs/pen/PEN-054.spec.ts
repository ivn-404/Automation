/**
 * PEN-054 — Concurrent StartRound must not double-spend the balance.
 *
 * Manual Test Case ID: PEN-054 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: fire several StartRound calls in parallel (all frames leave before any
 * completes) to probe a check-then-debit race. Whatever the hub deals, the ledger must
 * balance — every dealt bet debited exactly once, no negative balance, no free credit.
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
  startPenSession,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-054' as const;
const PARALLEL = 5;

test.describe('PEN — Concurrency & economy integrity', () => {
  test(`${MANUAL_TEST_ID} parallel StartRound does not double-spend`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const initial = session.balance ?? (await readBalance(session)) ?? 0;

      const completions = await invokeParallel(
        session,
        Array.from({ length: PARALLEL }, (_, i) => ({ target: 'StartRound', args: [bet, i % 3] })),
      );
      const dealt = asRounds('StartRound', completions).filter((r) => wasDealt(r.round));
      const sumBets = dealt.reduce((sum, r) => sum + (r.round?.betAmount ?? 0), 0);

      // Drain every round the server may have queued so the ledger can settle.
      let sumWins = 0;
      for (let i = 0; i < PARALLEL + 1; i += 1) {
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
            `Ledger balances after ${dealt.length}/${PARALLEL} dealt: ${initial} − Σbets ${sumBets.toFixed(2)} + Σwins ${sumWins.toFixed(2)} = ${expected} (actual ${actual})`,
            expected,
            actual,
          ),
        ],
        { initial, dealt: dealt.length, sumBets, sumWins, expected, actual, completions },
      );
    } finally {
      session.client.close();
    }
  });
});
