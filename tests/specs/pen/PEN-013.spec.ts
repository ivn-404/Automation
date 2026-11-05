/**
 * PEN-013 — Re-settling a losing card does not turn it into a win.
 *
 * Manual Test Case ID: PEN-013 (docs/catalogs/PERSONALTESTING.md §3)
 * Intent: buy until a loss (at most six cards), cash it out twice more.
 * The win stays 0 and the balance does not rise.
 */

import { test } from '../../fixtures/index.js';
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

const MANUAL_TEST_ID = 'PEN-013' as const;
const MAX_BUYS = 6;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} a losing card stays a loss`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      let lossBalance: number | undefined;
      for (let index = 0; index < MAX_BUYS; index += 1) {
        const bought = await startRound(session, minBet, 0);
        if (!wasDealt(bought.round)) {
          test.skip(true, `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
          return;
        }
        const card = bought.round.card;
        if (card.isWin || card.winAmount > 0) {
          await cashout(session);
          continue;
        }
        const settled = await cashout(session);
        lossBalance = settled.round?.balance ?? (await readBalance(session));
        break;
      }
      test.skip(lossBalance === undefined, `No losing card in ${MAX_BUYS} buys`);
      const before = lossBalance ?? 0;
      const second = await cashout(session);
      const third = await cashout(session);
      const after = third.round?.balance ?? (await readBalance(session)) ?? before;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            (second.round?.winAmount ?? 0) === 0 && (third.round?.winAmount ?? 0) === 0,
            `Repeat cashout of a loss paid ${(second.round?.winAmount ?? 0)} then ${(third.round?.winAmount ?? 0)}`,
            0,
            { second: second.round?.winAmount, third: third.round?.winAmount },
          ),
          penCheck(
            after <= before + 0.0001,
            `A losing card was not credited on re-settle (${before} → ${after})`,
            `<= ${before}`,
            after,
          ),
        ],
        { second: second.completion, third: third.completion, before, after },
      );
    } finally {
      session.client.close();
    }
  });
});
