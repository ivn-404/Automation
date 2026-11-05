/**
 * PEN-001 — A zero bet must not deal a free card.
 *
 * Manual Test Case ID: PEN-001 (docs/catalogs/PERSONALTESTING.md §2)
 * Intent: StartRound(0) is rejected. No card, and the balance does not move.
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-001' as const;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} zero bet is rejected, no card`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const before = session.balance ?? (await readBalance(session)) ?? 0;
      const { completion, round } = await startRound(session, 0, 0);
      const after = round?.balance ?? (await readBalance(session)) ?? before;
      const serverSaid = rejectionReason(completion, round);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            !wasDealt(round),
            wasDealt(round)
              ? `Zero bet dealt a card (bet ${round.betAmount})`
              : `Zero bet rejected, no card (${serverSaid ?? 'no reason given'})`,
            'rejected, no card',
            serverSaid ?? round?.betAmount,
          ),
          penCheck(
            Math.abs(after - before) <= 0.0001,
            `Zero bet left the balance unchanged (${before} → ${after})`,
            before,
            after,
          ),
        ],
        { startRound: completion, round: round?.raw ?? null, before, after },
      );
    } finally {
      session.client.close();
    }
  });
});
