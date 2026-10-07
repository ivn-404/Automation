/**
 * BF-004 — Buy Feature
 *
 * Manual Test Case ID: BF-004
 * Intent: Buy is disabled when balance is insufficient.
 *
 * Setup (staging): DiJoker host chrome "Balance … Update" → 100 USD, refresh game,
 * then attempt buy with the default buy-feature cost — purchase must not go through.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { sawBuyPurchaseWithin } from '../../support/canvas-bet-flow.js';
import { setLauncherBalanceAndRefreshGame } from '../../support/launcher-balance.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'BF-004' as const;

test.describe('BF — Buy Feature', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} buy disabled if insufficient balance`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'BF' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
      { type: 'launcherBalance', description: '100' },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });

      if (getLauncherMode() === 'staging') {
        await setLauncherBalanceAndRefreshGame({
          page,
          platform: sgapSession.platform,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
          amount: 100,
        });
      }

      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const hostShows100 = await page
        .getByText(/Balance:\s*100(?:\.0+)?\b/i)
        .first()
        .isVisible()
        .catch(() => false);
      verificationResults.push({
        kind: 'balance',
        passed: getLauncherMode() !== 'staging' || hostShows100,
        message: hostShows100
          ? 'Launcher balance set to 100 USD'
          : 'Launcher balance label did not show 100 after Update',
      });

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);

      // Default buy-feature value only — open panel and confirm; must not purchase.
      const buyWatch = sawBuyPurchaseWithin(page, 6_000);
      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 }).catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirm', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirmAlt', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      const sawBuy = await buyWatch;

      verificationResults.push({
        kind: 'bet',
        passed: !sawBuy,
        message: sawBuy
          ? 'Buy purchase fired with 100 USD balance (expected disabled / insufficient)'
          : 'Buy purchase blocked with insufficient balance (default buy cost)',
      });

      await sgapDriver
        .clickCanvas('buyFeatureCancel', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);

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
