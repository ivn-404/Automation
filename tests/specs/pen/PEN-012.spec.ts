/**
 * PEN-012 — Double Cashout credits a win at most once.
 *
 * Manual Test Case ID: PEN-012 (docs/PERSONALTESTING.md §3)
 * Intent: StartRound → Cashout → Cashout again. The second settlement must be a
 * no-op; the win must never be credited twice. Needs a joined session.
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

const MANUAL_TEST_ID = 'PEN-012' as const;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} double cashout credits win once`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const bought = await startRound(session, minBet, 0);
      test.skip(
        !wasDealt(bought.round),
        `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`,
      );

      const first = await cashout(session);
      const afterFirst = first.round?.balance ?? (await readBalance(session)) ?? 0;
      const second = await cashout(session);
      const afterSecond = second.round?.balance ?? (await readBalance(session)) ?? afterFirst;

      await expectPenChecks(testInfo, [
        penCheck(
          second.completion.error !== undefined || (second.round?.winAmount ?? 0) === 0,
          `Second Cashout is a no-op (${second.completion.error ?? `win ${second.round?.winAmount}`})`,
          'rejected / no extra win',
          second.completion.error ?? second.round?.winAmount,
        ),
        penCheck(
          afterSecond <= afterFirst + 0.0001,
          `Balance not credited twice (${afterFirst} → ${afterSecond})`,
          `<= ${afterFirst}`,
          afterSecond,
        ),
      ], { start: bought.completion, first: first.completion, second: second.completion, afterFirst, afterSecond });
    } finally {
      session.client.close();
    }
  });
});
