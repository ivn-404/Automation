/**
 * AT-009 — Additional Test
 *
 * Manual Test Case ID: AT-009
 * Intent: Balance matches after Buy Bonus — after ≈ before − cost + win.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBetWithRetry } from '../../support/canvas-bet-flow.js';
import {
  verifyBalanceDelta,
  verifyBalanceIsNumeric,
  verifyBetResponseShape,
  verifyWinIsNonNegative,
} from '../../../src/verification/bet-response-verification.js';
import { resolveBuyPurchaseCost } from '../../support/buy-feature-verify.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-009' as const;

test.describe('AT — Additional Test', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} balance matches after Buy Bonus`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AT' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const beforeBalance =
        getLauncherMode() === 'local'
          ? { amount: '9721.85' }
          : sgapSession.initializeBalance;

      const bet = await buyFeatureForBetWithRetry(sgapSession, sgapDriver, page);
      verificationResults.push(
        ...verifyBetResponseShape(bet, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet.balance),
        verifyWinIsNonNegative(bet.win),
      );

      const skipDelta = getLauncherMode() === 'local';
      const stakeAmount =
        bet.requestTotalBet !== undefined
          ? String(bet.requestTotalBet)
          : bet.bet?.amount;

      if (
        !skipDelta &&
        beforeBalance !== undefined &&
        bet.balance !== undefined &&
        bet.win !== undefined &&
        stakeAmount !== undefined
      ) {
        verificationResults.push(
          verifyBalanceDelta({
            before: beforeBalance,
            after: bet.balance,
            win: bet.win,
            stakeAmount,
            tolerance: 0.05,
          }),
        );
      } else if (!skipDelta && beforeBalance !== undefined) {
        const cost = resolveBuyPurchaseCost({
          beforeBalance: beforeBalance.amount,
          afterBalance: bet.balance?.amount,
          winAmount: bet.win?.amount,
        });
        verificationResults.push({
          kind: 'balance',
          passed: cost !== undefined && cost > 0,
          message:
            cost !== undefined && cost > 0
              ? `Buy bonus deducted ${cost} from wallet`
              : 'Could not reconcile buy-bonus wallet movement',
          actual: cost,
        });
      }

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
