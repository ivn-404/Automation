/**
 * PEN-056 — Two sockets sharing one token must not diverge the balance.
 *
 * Manual Test Case ID: PEN-056 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: open a second socket with the same token and act on both. Each connection must
 * see the other's debits/credits (one authoritative balance), with no double credit.
 */

import { test } from '../../fixtures/index.js';
import type { PenSession } from '../../support/pen-hub.js';
import {
  cashout,
  expectPenChecks,
  openSecondClient,
  penCheck,
  readBalance,
  requireJoined,
  rejectionReason,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-056' as const;

test.describe('PEN — Concurrency & economy integrity', () => {
  test(`${MANUAL_TEST_ID} two connections share one authoritative balance`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const initial = session.balance ?? (await readBalance(session)) ?? 0;

      const second = await openSecondClient(session);
      test.skip(!second.joined, `Second connection could not JoinScratch: ${second.joinError ?? 'unknown'}`);
      // The helpers only touch `.client`, so a client-only view drives the second socket.
      const sessionB = { ...session, client: second.client } as PenSession;

      let sumBets = 0;
      let sumWins = 0;

      const boughtA = await startRound(session, bet, 0);
      test.skip(!wasDealt(boughtA.round), `Connection A StartRound dealt no card: ${rejectionReason(boughtA.completion, boughtA.round) ?? 'unknown'}`);
      sumBets += boughtA.round?.betAmount ?? 0;
      const settledA = await cashout(session);
      sumWins += settledA.round?.winAmount ?? 0;

      // Connection B must observe A's activity in the authoritative balance.
      const balanceSeenByB = (await readBalance(sessionB)) ?? Number.NaN;

      const boughtB = await startRound(sessionB, bet, 1);
      if (wasDealt(boughtB.round)) {
        sumBets += boughtB.round?.betAmount ?? 0;
        const settledB = await cashout(sessionB);
        sumWins += settledB.round?.winAmount ?? 0;
      }

      const finalBalance = (await readBalance(session)) ?? Number.NaN;
      const expected = Math.round((initial - sumBets + sumWins) * 100) / 100;
      const actual = Math.round(finalBalance * 100) / 100;
      const expectedAfterA = Math.round((initial - (boughtA.round?.betAmount ?? 0) + (settledA.round?.winAmount ?? 0)) * 100) / 100;

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            Number.isFinite(balanceSeenByB) && Math.abs(balanceSeenByB - expectedAfterA) < 0.01,
            `Connection B sees A's activity (expected ${expectedAfterA}, B read ${balanceSeenByB})`,
            expectedAfterA,
            balanceSeenByB,
          ),
          penCheck(
            Number.isFinite(actual) && Math.abs(actual - expected) < 0.01,
            `No double-credit across sockets: ${initial} − Σbets ${sumBets.toFixed(2)} + Σwins ${sumWins.toFixed(2)} = ${expected} (actual ${actual})`,
            expected,
            actual,
          ),
        ],
        { initial, balanceSeenByB, expectedAfterA, sumBets, sumWins, expected, actual },
      );
      second.client.close();
    } finally {
      session.client.close();
    }
  });
});
