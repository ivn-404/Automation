/**
 * PEN-021 — A win has at least three matching symbols, and a loss does not.
 *
 * Manual Test Case ID: PEN-021 (docs/catalogs/PERSONALTESTING.md §4)
 * Intent: four buys. Each card agrees with the scratch win rule.
 */

import { test } from '../../fixtures/index.js';
import { verifyScratchWinRule } from '../../../src/verification/scratch-card-verification.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-021' as const;
const BUYS = 4;

test.describe('PEN — Outcome integrity', () => {
  test(`${MANUAL_TEST_ID} match count agrees with the card`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      const checks = [];
      let dealt = 0;
      for (let index = 0; index < BUYS; index += 1) {
        const bought = await startRound(session, minBet, index % 3);
        if (!wasDealt(bought.round)) {
          checks.push(
            penCheck(
              false,
              `StartRound ${index + 1} dealt no card (${rejectionReason(bought.completion, bought.round) ?? 'unknown'})`,
            ),
          );
          break;
        }
        dealt += 1;
        for (const result of verifyScratchWinRule(bought.round)) {
          checks.push(penCheck(result.passed, result.message, result.expected, result.actual));
        }
        await cashout(session);
      }
      test.skip(dealt === 0, 'No card was dealt');
      await expectPenChecks(testInfo, checks, { dealt });
    } finally {
      session.client.close();
    }
  });
});
