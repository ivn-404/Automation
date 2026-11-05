/**
 * PEN-027 — A second StartRound while a card is in play does not deal another.
 *
 * Manual Test Case ID: PEN-027 (docs/catalogs/PERSONALTESTING.md §6)
 * Intent: buy, then buy again before cashout. The second call deals no card
 * and does not credit the wallet.
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

const MANUAL_TEST_ID = 'PEN-027' as const;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} a second buy while in play is refused`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      const before = session.balance ?? (await readBalance(session)) ?? 0;
      const first = await startRound(session, minBet, 0);
      test.skip(
        !wasDealt(first.round),
        `StartRound dealt no card: ${rejectionReason(first.completion, first.round) ?? 'unknown'}`,
      );
      const afterFirst = first.round.balance ?? (await readBalance(session)) ?? before;
      const second = await startRound(session, minBet, 1);
      const afterSecond = second.round?.balance ?? (await readBalance(session)) ?? afterFirst;
      await cashout(session);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            !wasDealt(second.round),
            wasDealt(second.round)
              ? `Second StartRound dealt another card at bet ${second.round.betAmount}`
              : `Second StartRound was refused (${rejectionReason(second.completion, second.round) ?? 'no reason given'})`,
            'no second card',
            rejectionReason(second.completion, second.round) ?? second.round?.betAmount,
          ),
          penCheck(
            afterSecond <= afterFirst + 0.0001,
            `The open round was not credited by the second buy (${afterFirst} → ${afterSecond})`,
            `<= ${afterFirst}`,
            afterSecond,
          ),
        ],
        { first: first.completion, second: second.completion, before, afterFirst, afterSecond },
      );
    } finally {
      session.client.close();
    }
  });
});
