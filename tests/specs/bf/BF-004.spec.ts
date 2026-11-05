/**
 * BF-004 — Buy Feature
 *
 * Manual Test Case ID: BF-004
 * Intent: Buy is disabled when balance is insufficient.
 *
 * Setup (staging): one spin reads the game's stake, then DiJoker host chrome
 * "Balance … Update" → half the default buy cost (stake × buyFeatureMultiplier),
 * refresh game, attempt buy — purchase must not go through. A fixed 100 USD is
 * exactly the buy cost on games that buy at 100× a 1.00 bet.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { sawBuyPurchaseWithin, spinForBet } from '../../support/canvas-bet-flow.js';
import { expectedBuyCost, parseResponseStake } from '../../support/buy-feature-verify.js';
import { isBuyPurchaseResponse } from '../../../src/network/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';
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

      const stakeResponse = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: 60_000 },
      );
      await spinForBet(sgapSession, sgapDriver, page);
      const stake = parseResponseStake(await stakeResponse) ?? 1;
      const buyCost = expectedBuyCost(stake, sgapSession.manifest);
      const balance = Math.max(stake, Math.floor((buyCost / 2) * 100) / 100);
      testInfo.annotations.push(
        { type: 'launcherBalance', description: String(balance) },
        { type: 'buyCost', description: `${buyCost} (stake ${stake})` },
      );

      if (getLauncherMode() === 'staging') {
        await setLauncherBalanceAndRefreshGame({
          page,
          platform: sgapSession.platform,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
          amount: balance,
        });
      }

      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const hostLabel = await page
        .getByText(/Balance:\s*[\d,]+(?:\.\d+)?/i)
        .first()
        .textContent({ timeout: 5_000 })
        .catch(() => null);
      const hostBalance = Number((hostLabel?.match(/Balance:\s*([\d,]+(?:\.\d+)?)/i)?.[1] ?? '').replace(/,/g, ''));
      const hostShowsBalance = Number.isFinite(hostBalance) && Math.abs(hostBalance - balance) < 0.01;
      verificationResults.push({
        kind: 'balance',
        passed: getLauncherMode() !== 'staging' || hostShowsBalance,
        message: hostShowsBalance
          ? `Launcher balance set to ${balance} USD (buy cost ${buyCost})`
          : `Launcher balance label did not show ${balance} after Update`,
      });

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);

      // Default buy-feature value only — open panel and confirm; must not purchase.
      let straySpin = false;
      const watchStray = (response: import('@playwright/test').Response): void => {
        if (response.ok() && matchesBetUrl(response.url()) && !isBuyPurchaseResponse(response)) {
          straySpin = true;
        }
      };
      page.on('response', watchStray);
      const buyWatch = sawBuyPurchaseWithin(page, 6_000);
      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 }).catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirm', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirmAlt', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      const sawBuy = await buyWatch;
      page.off('response', watchStray);
      // A confirm tap that reaches the base Spin means no buy panel covered the HUD: BUY did not open.
      const panelBlocked = straySpin && !sawBuy;
      if (panelBlocked) {
        testInfo.annotations.push({ type: 'buyPanel', description: 'did not open (confirm tap reached base Spin)' });
      }

      verificationResults.push({
        kind: 'bet',
        passed: !sawBuy,
        message: sawBuy
          ? `Buy purchase fired with ${balance} USD balance below the ${buyCost} buy cost (expected disabled / insufficient)`
          : panelBlocked
            ? `BUY did not open its panel with ${balance} USD balance below the ${buyCost} buy cost`
            : `Buy purchase blocked with ${balance} USD balance below the ${buyCost} buy cost`,
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
