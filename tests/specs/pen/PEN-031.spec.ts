/**
 * PEN-031 — A Cashout sent before StartRound finishes does not pay a missing round.
 *
 * Manual Test Case ID: PEN-031 (docs/catalogs/PERSONALTESTING.md §6)
 * Intent: with no card in play, send Cashout and then StartRound without waiting.
 * The wallet moves by at most one stake and that card's win.
 */

import { test } from '../../fixtures/index.js';
import { parseScratchRound } from '../../../src/network/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  safeInvoke,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-031' as const;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} early cashout does not settle a missing round`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      const earlyPending = safeInvoke(session, 'Cashout', []);
      const bought = await startRound(session, minBet, 0);
      const early = await earlyPending;
      const earlyRound = early.error === undefined ? parseScratchRound('Cashout', early.result, []) : undefined;
      const dealt = wasDealt(bought.round);
      const stake = dealt ? bought.round.betAmount : 0;
      const dealtWin = dealt ? bought.round.card.winAmount : 0;
      await cashout(session);
      const after = (await readBalance(session)) ?? before;
      const earlyWin = earlyRound?.winAmount ?? 0;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            dealt || (earlyWin === 0 && Math.abs(after - before) <= 0.0001),
            dealt
              ? `StartRound dealt a ${stake} card while Cashout was in flight`
              : `Cashout before a card paid ${earlyWin} and the balance went ${before} → ${after}`,
            'no credit without a dealt card',
            { earlyWin, before, after, earlyError: early.error },
          ),
          penCheck(
            after <= before - stake + dealtWin + 0.0001 && after >= before - stake - 0.0001,
            `The race moved the wallet by one stake and at most one win (${before} → ${after}, stake ${stake}, win ${dealtWin})`,
            `${before - stake} to ${before - stake + dealtWin}`,
            after,
          ),
        ],
        { before, after, stake, dealtWin, early, bought: bought.completion },
      );
    } finally {
      session.client.close();
    }
  });
});
