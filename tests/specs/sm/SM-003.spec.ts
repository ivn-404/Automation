/**
 * SM-003 — State Management
 *
 * Manual Test Case ID: SM-003
 * Regression meaning: Buy Feature must not be accessible during Autoplay —
 * if a buy purchase still fires while autoplay is active, the test fails.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import {
  expectNoBetWithin,
  sawBuyPurchaseWithin,
} from '../../support/canvas-bet-flow.js';
import {
  prepareAutoplayCanvas,
  startAutoplayCollectingBets,
  stopAutoplayQuietly,
} from '../../support/autoplay-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';

const MANUAL_TEST_ID = 'SM-003' as const;

const isBetResponse = (url: string): boolean => matchesBetUrl(url);

test.describe('SM — State Management', () => {
  requireCapabilities('buyFeature', 'autoplay');

  test(`${MANUAL_TEST_ID} cannot buy during autoplay`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'SM' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await prepareAutoplayCanvas(
        sgapSession,
        sgapDriver,
        page,
        sgapSession.platform.getInitializeBody(),
      );

      await startAutoplayCollectingBets({
        sgapSession,
        sgapDriver,
        page,
        betCount: 1,
        perBetTimeoutMs: 90_000,
        startTimeoutMs: 30_000,
        spinCountAction: 'autoplaySpins10',
      });
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(true);

      const buyWatch = sawBuyPurchaseWithin(page, 4_000);
      await sgapDriver
        .clickCanvas('buyFeature', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirm', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      const sawBuy = await buyWatch;

      verificationResults.push({
        kind: 'stateManagement',
        passed: !sawBuy,
        message: sawBuy
          ? 'Buy Feature still purchasable during autoplay (expected locked)'
          : 'Buy Feature not purchasable during autoplay',
      });

      await stopAutoplayQuietly(sgapSession, page);
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(false);
      await page
        .waitForResponse(
          (response) => response.ok() && isBetResponse(response.url()),
          { timeout: 8_000 },
        )
        .catch(() => undefined);
      await expectNoBetWithin(page, 4_000);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6);

      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 });
      await sgapDriver
        .clickCanvas('buyFeatureCancel', { timeoutMs: 15_000, singleInput: true })
        .catch(() => undefined);
      verificationResults.push({
        kind: 'stateManagement',
        passed: true,
        message: 'Buy Feature opens again after autoplay stop',
      });

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
      await stopAutoplayQuietly(sgapSession, page);
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
