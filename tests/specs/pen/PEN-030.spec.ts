/**
 * PEN-030 — Two Cashout frames in one tick credit the win once.
 *
 * Manual Test Case ID: PEN-030 (docs/catalogs/PERSONALTESTING.md §6)
 * Intent: buy a card, then send two Cashout invocations together.
 * The wallet gains that card's win at most once.
 */

import { test } from '../../fixtures/index.js';
import {
  asRounds,
  cashout,
  expectPenChecks,
  invokeParallel,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-030' as const;
const MAX_BUYS = 6;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} two cashouts in one tick credit once`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      let played: Awaited<ReturnType<typeof startRound>> | undefined;
      for (let index = 0; index < MAX_BUYS; index += 1) {
        const bought = await startRound(session, minBet, 0);
        if (!wasDealt(bought.round)) {
          test.skip(true, `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
          return;
        }
        const win = bought.round.card.winAmount > 0 || bought.round.card.isWin;
        if (win || index === MAX_BUYS - 1) {
          played = bought;
          break;
        }
        await cashout(session);
      }
      if (played === undefined || !wasDealt(played.round)) {
        test.skip(true, 'No card was left in play');
        return;
      }
      const dealtWin = played.round.card.winAmount;
      const afterBuy = played.round.balance ?? (await readBalance(session)) ?? 0;
      const raced = asRounds(
        'Cashout',
        await invokeParallel(session, [
          { target: 'Cashout', args: [] },
          { target: 'Cashout', args: [] },
        ]),
      );
      await cashout(session);
      const after = (await readBalance(session)) ?? afterBuy;
      const credited = after - afterBuy;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            credited <= dealtWin + 0.0001 && credited >= -0.0001,
            `Two cashouts credited ${credited} for a dealt win of ${dealtWin} (${afterBuy} → ${after})`,
            `0 to ${dealtWin}`,
            { credited, raced: raced.map((item) => item.round?.winAmount ?? item.completion.error) },
          ),
        ],
        { dealtWin, afterBuy, after, raced: raced.map((item) => item.completion) },
      );
    } finally {
      session.client.close();
    }
  });
});
