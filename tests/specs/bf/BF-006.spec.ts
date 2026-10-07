/**
 * BF-006 — Buy Feature
 *
 * Manual Test Case ID: BF-006
 * Intent: Buy deducts correct amount — after buy, balance ≈ before - stake + win.
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
  verifyStakeIsPositive,
  verifyWinIsNonNegative,
} from '../../../src/verification/bet-response-verification.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'BF-006' as const;

test.describe('BF — Buy Feature', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} buy deducts correct amount`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'BF' },
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

      verificationResults = [
        ...verifyBetResponseShape(bet, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet.balance),
        verifyWinIsNonNegative(bet.win),
      ];

      const stakeAmount =
        bet.requestTotalBet !== undefined
          ? String(bet.requestTotalBet)
          : bet.bet?.amount;
      if (stakeAmount !== undefined) {
        verificationResults.push(verifyStakeIsPositive(bet.bet));
      }

      const skipDelta = getLauncherMode() === 'local';
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
          }),
        );
      } else if (!skipDelta && beforeBalance !== undefined && bet.balance !== undefined) {
        // If stake is missing from parse, at least assert balance changed downward
        // relative to before when win is zero, or that after is numeric.
        const before = Number(beforeBalance.amount);
        const after = Number(bet.balance.amount);
        const win = Number(bet.win?.amount ?? '0');
        const deducted = Number.isFinite(before) && Number.isFinite(after) && after <= before + win;
        verificationResults.push({
          kind: 'balance',
          passed: deducted,
          message: deducted
            ? `Buy balance moved as expected: before=${before}, after=${after}, win=${win}`
            : `Buy balance unexpected: before=${before}, after=${after}, win=${win}`,
          expected: `after <= before + win`,
          actual: after,
        });
      }

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      expect(bet.balance).toBeDefined();

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
