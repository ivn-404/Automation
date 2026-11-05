/**
 * PEN-025 — Two tabs of one player do not duplicate the balance.
 *
 * Manual Test Case ID: PEN-025 (docs/catalogs/PERSONALTESTING.md §5)
 */

import { test } from '../../fixtures/index.js';
import { openSecondScratchPlayer } from '../../support/pen-second-scratch.js';
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

const MANUAL_TEST_ID = 'PEN-025' as const;

test.describe('PEN — Session', () => {
  test(`${MANUAL_TEST_ID} a second tab does not double the wallet`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(420_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let closeOther: (() => Promise<void>) | undefined;
    try {
      requireJoined(session);
      await cashout(session);
      const playerId = process.env.SGAP_PLAYER_ID ?? 'Sugar Wonderland_PEN20';
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      const minBet = session.config?.minBet ?? 0.1;
      const other = await openSecondScratchPlayer(
        page,
        sgapSession.environment,
        sgapSession.manifest,
        sgapSession.ui,
        playerId,
      );
      closeOther = other.close;
      const otherSession = { ...session, client: other.client, joinArgs: other.joinArgs };
      const left = await startRound(session, minBet, 0);
      const right = await startRound(otherSession, minBet, 0);
      if (wasDealt(left.round)) {
        await cashout(session);
      }
      if (wasDealt(right.round)) {
        await cashout(otherSession);
      }
      const after = (await readBalance(session)) ?? before;
      const stakes =
        (wasDealt(left.round) ? left.round.betAmount : 0) + (wasDealt(right.round) ? right.round.betAmount : 0);
      const wins = (left.round?.card?.winAmount ?? 0) + (right.round?.card?.winAmount ?? 0);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            after <= before - stakes + wins + 0.02 && after >= before - stakes - 0.02,
            `Two tabs settled at ${after} from ${before} (stakes ${stakes}, wins ${wins})`,
            `${before - stakes} to ${before - stakes + wins}`,
            after,
          ),
        ],
        { before, after, stakes, wins },
      );
    } finally {
      await closeOther?.();
      session.client.close();
    }
  });
});
