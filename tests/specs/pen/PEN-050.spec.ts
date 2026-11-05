/**
 * PEN-050 — Player B's cashout does not settle player A's open card.
 *
 * Manual Test Case ID: PEN-050 (docs/catalogs/PERSONALTESTING.md §security-extensions)
 */

import { test } from '../../fixtures/index.js';
import { openSecondScratchPlayer } from '../../support/pen-second-scratch.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-050' as const;
const OTHER_PLAYER = 'Sugar Wonderland_PEN23B';

test.describe('PEN — Authorization', () => {
  test(`${MANUAL_TEST_ID} another player cannot cash out this round`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(420_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let closeOther: (() => Promise<void>) | undefined;
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      const bought = await startRound(session, minBet, 0);
      if (!wasDealt(bought.round)) {
        test.skip(true, `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
        return;
      }
      const afterBuy = bought.round.balance ?? (await readBalance(session)) ?? 0;
      const other = await openSecondScratchPlayer(
        page,
        sgapSession.environment,
        sgapSession.manifest,
        sgapSession.ui,
        OTHER_PLAYER,
      );
      closeOther = other.close;
      const otherSession = { ...session, client: other.client, joinArgs: other.joinArgs };
      const stolen = await cashout(otherSession);
      const after = (await readBalance(session)) ?? afterBuy;
      await cashout(session);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            Math.abs(after - afterBuy) <= 0.0001,
            `Player B's cashout left A's wallet at ${after} (was ${afterBuy})`,
            afterBuy,
            after,
          ),
          penCheck(
            (stolen.round?.winAmount ?? 0) === 0 || stolen.completion.error !== undefined || stolen.round?.errorCode !== null,
            `Player B did not collect A's win (${stolen.completion.error ?? stolen.round?.winAmount ?? 'no win'})`,
            'no win for B',
            stolen.round?.winAmount ?? stolen.completion.error,
          ),
        ],
        { afterBuy, after, stolen: stolen.completion },
      );
    } finally {
      await closeOther?.();
      session.client.close();
    }
  });
});
