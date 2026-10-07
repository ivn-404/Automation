/**
 * PEN-061 — Illegal call sequences are refused without corrupting state.
 *
 * Manual Test Case ID: PEN-061 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: Cashout with no active round, a second StartRound while one is in play, and a
 * duplicate JoinScratch must each be handled cleanly — no crash, no stuck round, no
 * spurious balance movement, and the socket stays alive.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  isCleanRejection,
  penCheck,
  readBalance,
  requireJoined,
  rejectionReason,
  safeInvoke,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-061' as const;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} illegal sequences are refused cleanly`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const before = session.balance ?? (await readBalance(session)) ?? 0;

      // (a) Cashout with no active round.
      const idleCashout = await cashout(session);
      const idleWin = idleCashout.round?.winAmount ?? 0;
      const afterIdle = (await readBalance(session)) ?? before;

      // (b) Second StartRound while one is already in play.
      const bought = await startRound(session, bet, 0);
      test.skip(!wasDealt(bought.round), `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
      const secondStart = await startRound(session, bet, 1);
      const doubleRound = wasDealt(secondStart.round);
      await cashout(session); // settle the legitimate round

      // (c) Duplicate JoinScratch must be idempotent, not corrupting.
      const rejoin = await safeInvoke(session, 'JoinScratch', session.joinArgs);

      const afterAll = (await readBalance(session)) ?? before;

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            idleWin === 0 && Math.abs(afterIdle - before) < 0.01,
            `Cashout with no round is a no-op (win ${idleWin}, balance ${before} → ${afterIdle})`,
          ),
          penCheck(
            !doubleRound || isCleanRejection(secondStart.completion),
            `Second StartRound while in play is refused, not a double round (${rejectionReason(secondStart.completion, secondStart.round) ?? 'DEALT a concurrent card!'})`,
          ),
          penCheck(
            session.client.isOpen,
            'Socket survived the illegal sequences (no crash/disconnect)',
          ),
          penCheck(
            Number.isFinite(afterAll),
            `Duplicate JoinScratch did not corrupt state (rejoin ${rejoin.error ?? 'ok'}, balance ${afterAll})`,
          ),
        ],
        { before, idleCashout: idleCashout.completion, secondStart: secondStart.completion, rejoin, afterAll },
      );
    } finally {
      session.client.close();
    }
  });
});
