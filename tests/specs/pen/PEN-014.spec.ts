/**
 * PEN-014 — Balance reconciles exactly over many rounds.
 *
 * Manual Test Case ID: PEN-014 (docs/PERSONALTESTING.md §3)
 * Intent: after N buy/settle rounds, finalBalance == initial − Σbets + Σwins with no
 * drift or rounding leak. Uses fractional bets to surface precision errors. Needs a
 * joined session.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-014' as const;
const ROUNDS = 8;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} balance reconciles over ${ROUNDS} rounds`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const initial = session.balance ?? (await readBalance(session)) ?? 0;
      let sumBets = 0;
      let sumWins = 0;
      const bets = [minBet, minBet * 2, 1.2, 0.3]; // include fractional stakes
      for (let i = 0; i < ROUNDS; i += 1) {
        const bet = bets[i % bets.length] ?? minBet;
        const bought = await startRound(session, bet, i % 3);
        if (!wasDealt(bought.round)) {
          continue;
        }
        sumBets += bought.round.betAmount;
        const settled = await cashout(session);
        sumWins += settled.round?.winAmount ?? 0;
      }
      const expected = Math.round((initial - sumBets + sumWins) * 100) / 100;
      const actual = Math.round(((await readBalance(session)) ?? Number.NaN) * 100) / 100;
      await expectPenChecks(testInfo, [
        penCheck(
          Number.isFinite(actual) && Math.abs(actual - expected) < 0.005,
          `Reconciles: ${initial} − Σbets ${sumBets.toFixed(2)} + Σwins ${sumWins.toFixed(2)} = ${expected} (actual ${actual})`,
          expected,
          actual,
        ),
      ], { initial, sumBets, sumWins, expected, actual });
    } finally {
      session.client.close();
    }
  });
});
