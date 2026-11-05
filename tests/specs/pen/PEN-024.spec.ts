/**
 * PEN-024 — A client balance or bet limit does not raise the server wallet.
 *
 * Manual Test Case ID: PEN-024 (docs/catalogs/PERSONALTESTING.md §5)
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  safeInvoke,
  startPenSession,
  startRound,
  wasDealt,
  cashout,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-024' as const;

test.describe('PEN — Session', () => {
  test(`${MANUAL_TEST_ID} client balance and bet limit are ignored`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      const maxBet = session.config?.maxBet ?? 100;
      const joined = await safeInvoke(session, 'JoinScratch', [...session.joinArgs, { balance: 999_999, betLimit: 999_999 }]);
      const afterJoin = (await readBalance(session)) ?? before;
      const oversized = await startRound(session, 1_000_000_000, 0);
      if (wasDealt(oversized.round)) {
        await cashout(session);
      }
      const after = (await readBalance(session)) ?? afterJoin;
      const booked = wasDealt(oversized.round) ? oversized.round.betAmount : undefined;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            afterJoin <= before + 0.0001,
            `A client balance of 999999 left the wallet at ${afterJoin} (was ${before})`,
            `<= ${before}`,
            afterJoin,
          ),
          penCheck(
            !wasDealt(oversized.round) || (booked !== undefined && booked <= maxBet + 0.0001),
            wasDealt(oversized.round)
              ? `Bet above maxBet was booked at ${booked} (maxBet ${maxBet})`
              : `Bet above maxBet was rejected (${rejectionReason(oversized.completion, oversized.round) ?? 'no reason'})`,
            `rejected or <= ${maxBet}`,
            booked ?? rejectionReason(oversized.completion, oversized.round),
          ),
          penCheck(after <= before + 0.0001, `The wallet did not rise (${before} → ${after})`, `<= ${before}`, after),
        ],
        { joined, before, afterJoin, after },
      );
    } finally {
      session.client.close();
    }
  });
});
