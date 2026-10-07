/**
 * AT-010 — Additional Test
 *
 * Manual Test Case ID: AT-010
 * Intent: Buy Feature force resolve — a completed buy must settle to idle even
 * if the UI is interrupted; extra confirms must not double-buy; play continues.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame, spamClickSkip } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBetWithRetry, sawBuyPurchaseWithin, spinForBet } from '../../support/canvas-bet-flow.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
  isFreeSpinBundleComplete,
} from '../../support/buy-feature-verify.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-010' as const;

test.describe('AT — Additional Test', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} Buy Feature force resolve`, async ({
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
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const buy = await buyFeatureForBetWithRetry(sgapSession, sgapDriver, page, {
        settleAfter: false,
      });
      const entered = featureEnteredFromBody(buy.raw);
      const completed = buy.transactionState === 'completed';
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered && completed,
        message:
          entered && completed
            ? `Buy completed and entered feature (remaining=${freeSpinItemsRemaining(buy.raw)}, bundled=${isFreeSpinBundleComplete(buy.raw)})`
            : `Buy did not force-resolve (entered=${entered}, transactionState=${buy.transactionState ?? 'undefined'})`,
        actual: buy.transactionState,
      });

      const extraBuyWatch = sawBuyPurchaseWithin(page, 4_000);
      await sgapDriver
        .clickCanvas('buyFeatureConfirm', { timeoutMs: 8_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirmAlt', { timeoutMs: 8_000, singleInput: true })
        .catch(() => undefined);
      const sawDoubleBuy = await extraBuyWatch;
      verificationResults.push({
        kind: 'bet',
        passed: !sawDoubleBuy,
        message: sawDoubleBuy
          ? 'Second buy purchase fired while forcing feature resolve'
          : 'No double buy while interrupting the feature UI',
      });

      await spamClickSkip(sgapDriver, sgapSession.manifest, 8, { force: true });
      await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);

      const spinAvailable = await sgapSession.spin.isAvailable();
      verificationResults.push({
        kind: 'controllerLock',
        passed: spinAvailable,
        message: spinAvailable
          ? 'Spin controller available after forced feature resolve'
          : 'Spin controller still locked after forced feature resolve',
      });

      const continued = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(continued, { requireCompleted: true }));

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
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'failed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: message,
        verificationResults,
      });
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
