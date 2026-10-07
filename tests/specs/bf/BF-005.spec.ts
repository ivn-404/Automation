/**
 * BF-005 — Buy Feature
 *
 * Manual Test Case ID: BF-005
 * Intent: buy feature is disabled while Amplify bet is enabled.
 * Amplify on-state is /bet `isEnhancedBet=true` after the coin tap.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { sawBuyPurchaseWithin, spinForEnhancedBet } from '../../support/canvas-bet-flow.js';
import { prepareCanvasAmplify } from '../../support/canvas-bet-control.js';
import { verifyIsEnhancedBet } from '../../../src/verification/bet-response-verification.js';

const MANUAL_TEST_ID = 'BF-005' as const;

test.describe('BF — Buy Feature', () => {
  requireCapabilities('buyFeature', 'amplifyBet');

  test(`${MANUAL_TEST_ID} buy is disabled when Amplify is enabled`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

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
      await expect(sgapSession.amplifyBet.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);
      await prepareCanvasAmplify(sgapSession, sgapDriver, page);
      // Prove amplify on /bet (local flag alone is not enough — toggle can miss).
      const amplifyBet = await spinForEnhancedBet(sgapSession, sgapDriver, page, true);
      verificationResults.push(verifyIsEnhancedBet(amplifyBet.isEnhancedBet, true));
      expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(true);

      const buyWatch = sawBuyPurchaseWithin(page, 5_000);
      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 }).catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirm', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirmAlt', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      const sawBuyWhileAmplify = await buyWatch;

      verificationResults.push({
        kind: 'bet',
        passed: !sawBuyWhileAmplify,
        message: sawBuyWhileAmplify
          ? 'Buy purchase fired while Amplify enabled (expected disabled)'
          : 'No buy purchase while Amplify enabled',
      });

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);
      await sgapSession.amplifyBet.disable({ timeoutMs: 15_000 });
      expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(false);

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 });
      await sgapDriver
        .clickCanvas('buyFeatureCancel', { timeoutMs: 15_000, singleInput: true })
        .catch(() => undefined);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);

      verificationResults.push({
        kind: 'bet',
        passed: true,
        message: 'Buy panel opens again after Amplify disabled',
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
      await sgapSession.amplifyBet.disable({ timeoutMs: 10_000 }).catch(() => undefined);
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
