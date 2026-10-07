/**
 * PEN-062 — Disconnecting mid-round cannot change the fixed outcome.
 *
 * Manual Test Case ID: PEN-062 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: buy a card, drop the socket without settling, then reconnect with the same
 * token. The round's outcome is fixed at StartRound, so the final balance must equal
 * initial − bet + dealtWin — a player can neither abandon a loser for a refund nor lose
 * a legitimately dealt win by disconnecting.
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

const MANUAL_TEST_ID = 'PEN-062' as const;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} mid-round disconnect keeps the ledger exact`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const before = session.balance ?? (await readBalance(session)) ?? 0;

      const bought = await startRound(session, bet, 0);
      test.skip(!wasDealt(bought.round), `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
      const betAmount = bought.round?.betAmount ?? bet;
      const dealtWin = bought.round?.card?.winAmount ?? bought.round?.winAmount ?? 0;

      // Drop the socket abruptly, mid-round, without cashing out.
      session.client.close();

      // Reconnect with the same token and settle whatever the server still holds.
      const reconnected = await openSecondClient(session);
      test.skip(!reconnected.joined, `Reconnect could not JoinScratch: ${reconnected.joinError ?? 'unknown'}`);
      const sessionB = { ...session, client: reconnected.client } as PenSession;
      for (let i = 0; i < 2; i += 1) {
        const settled = await cashout(sessionB);
        if (settled.completion.error !== undefined || settled.round === undefined || settled.round.errorCode !== null) {
          break;
        }
      }

      const finalBalance = (await readBalance(sessionB)) ?? Number.NaN;
      const expected = Math.round((before - betAmount + dealtWin) * 100) / 100;
      const actual = Math.round(finalBalance * 100) / 100;

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            Number.isFinite(actual) && Math.abs(actual - expected) < 0.01,
            `Disconnect did not change the fixed outcome: ${before} − bet ${betAmount} + dealtWin ${dealtWin} = ${expected} (actual ${actual})`,
            expected,
            actual,
          ),
          penCheck(
            actual <= before - betAmount + dealtWin + 0.0001,
            `No free refund of the in-play bet (actual ${actual} <= ${expected})`,
          ),
        ],
        { before, betAmount, dealtWin, expected, actual },
      );
      reconnected.client.close();
    } finally {
      session.client.close();
    }
  });
});
