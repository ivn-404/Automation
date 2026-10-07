/**
 * PEN-002 — Negative bet must never credit the balance.
 *
 * Manual Test Case ID: PEN-002 (docs/PERSONALTESTING.md §2)
 * Intent: StartRound with a negative stake (bet = -100) must be rejected — the
 * server must not "book" a negative bet as a credit or deal a card. Balance must
 * not rise. Needs a joined session (skips while the hub outage blocks JoinScratch).
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

const MANUAL_TEST_ID = 'PEN-002' as const;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} negative bet is rejected, no credit`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const before = session.balance ?? (await readBalance(session)) ?? 0;
      const { completion, round } = await startRound(session, -100, 0);
      const after = round?.balance ?? (await readBalance(session)) ?? before;
      const serverSaid = rejectionReason(completion, round);
      await expectPenChecks(testInfo, [
        penCheck(
          !wasDealt(round),
          `Negative bet rejected, no card dealt (${serverSaid ?? `card dealt, bet ${round?.betAmount} — BAD`})`,
          'rejected, no card',
          serverSaid ?? { betAmount: round?.betAmount, status: round?.status },
        ),
        penCheck(after <= before + 0.0001, `Balance did not rise on a negative bet (${before} → ${after})`, `<= ${before}`, after),
      ], { startRound: completion, round: round?.raw ?? null, before, after });
    } finally {
      session.client.close();
    }
  });
});
