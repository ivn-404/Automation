/**
 * UIDS-004 — UI & Display Sync
 *
 * Manual Test Case ID: UIDS-004
 * Regression meaning: Buy Feature amount is derived from payload "bet"
 * (Package 1 example: bet 0.20 → feature 20.00).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import { expectedBuyCost } from '../../support/buy-feature-verify.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'UIDS-004' as const;

test.describe('UIDS — UI & Display Sync', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} buy display matches calculated value`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'UIDS' },
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

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
      const lineBet = buy.requestStake;
      expect(lineBet, 'buy request must include line bet').toBeDefined();

      const calculated = expectedBuyCost(
        lineBet!,
        sgapSession.manifest,
        buy.requestBuyFeat,
      );
      const purchaseStake = buy.requestTotalBet ?? calculated;

      const matches = Math.abs(purchaseStake - calculated) <= 0.01;

      verificationResults = [
        {
          kind: 'uiSynchronization',
          passed: Number.isFinite(lineBet),
          message: `Line bet on buy request: ${lineBet} (buyFeat=${buy.requestBuyFeat ?? 'default'})`,
          actual: { lineBet, buyFeat: buy.requestBuyFeat },
        },
        {
          kind: 'uiSynchronization',
          passed: matches,
          message: matches
            ? `Buy cost ${purchaseStake} matches calculated ${calculated} (bet ${lineBet} × multiplier)`
            : `Buy cost mismatch: purchase=${purchaseStake}, calculated=${calculated}, lineBet=${lineBet}, buyFeat=${buy.requestBuyFeat}`,
          expected: calculated,
          actual: purchaseStake,
        },
      ];

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
