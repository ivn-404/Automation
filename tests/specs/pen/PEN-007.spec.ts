/**
 * PEN-007 — Out-of-range gridIndex is rejected.
 *
 * Manual Test Case ID: PEN-007 (docs/PERSONALTESTING.md §2)
 * Intent: StartRound with a gridIndex outside the valid set (-1, 99, 2.5, "0") must
 * be rejected with no round dealt, or clamped to a valid grid dimension (3/4/5) —
 * never index into undefined server arrays. Needs a joined session.
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-007' as const;
const BAD_INDICES: readonly unknown[] = [-1, 99, 2.5, '0'];
const VALID_DIMENSIONS = new Set([3, 4, 5]);

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} out-of-range gridIndex rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const checks = [];
      const evidence = [];
      for (const gridIndex of BAD_INDICES) {
        const { completion, round } = await startRound(session, minBet, gridIndex);
        evidence.push({ gridIndex, completion });
        const reason = rejectionReason(completion, round);
        const dealt = wasDealt(round);
        checks.push(
          penCheck(
            !dealt || VALID_DIMENSIONS.has(round.card.gridDimension),
            dealt
              ? `gridIndex ${JSON.stringify(gridIndex)}: card dealt, clamped to ${round.card.gridDimension}x${round.card.gridDimension}`
              : `gridIndex ${JSON.stringify(gridIndex)}: rejected, no card dealt (${reason ?? 'no reason given'})`,
            'rejected or valid grid',
            dealt ? round.card.gridDimension : reason,
          ),
        );
        if (dealt) {
          await session.client.invoke('Cashout', []).catch(() => undefined);
        }
      }
      await expectPenChecks(testInfo, checks, evidence);
    } finally {
      session.client.close();
    }
  });
});
