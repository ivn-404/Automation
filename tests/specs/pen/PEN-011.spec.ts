/**
 * PEN-011 — Cashout with no active round is a no-op.
 *
 * Manual Test Case ID: PEN-011 (docs/PERSONALTESTING.md §3)
 * Intent: calling Cashout when no card is in play must be rejected ("No active
 * round.") and must not credit the balance. Needs a joined session.
 */

import { test } from '../../fixtures/index.js';
import { cashout, expectPenChecks, penCheck, readBalance, requireJoined, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-011' as const;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} cashout without a round is a no-op`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const before = session.balance ?? (await readBalance(session)) ?? 0;
      const { completion, round } = await cashout(session);
      const after = round?.balance ?? (await readBalance(session)) ?? before;
      await expectPenChecks(testInfo, [
        penCheck(
          completion.error !== undefined || (round !== undefined && round.winAmount === 0),
          `Cashout with no round rejected / no win (${completion.error ?? `win ${round?.winAmount}`})`,
          'rejected / no credit',
          completion.error ?? round?.winAmount,
        ),
        penCheck(after <= before + 0.0001, `Balance unchanged (${before} → ${after})`, `<= ${before}`, after),
      ], { cashout: completion, before, after });
    } finally {
      session.client.close();
    }
  });
});
