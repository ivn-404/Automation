/**
 * AP-009 — Autoplay
 *
 * Manual Test Case ID: AP-009
 * Intent: while autoplay is active, Amplify / Bet / Buy Feature controls are disabled.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { sawBuyPurchaseWithin } from '../../support/canvas-bet-flow.js';
import {
  prepareAutoplayCanvas,
  stakeFromBetResponse,
  startAutoplayCollectingBets,
  stopAutoplayQuietly,
  watchBetResponsesDuring,
} from '../../support/autoplay-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AP-009' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('buyFeature', 'autoplay', 'amplifyBet');

  test(`${MANUAL_TEST_ID} autoplay disables Amplify, Bet, and Buy Feature`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AP' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.amplifyBet.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.bet.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await prepareAutoplayCanvas(sgapSession, sgapDriver, page);

      const firstBets = await startAutoplayCollectingBets({
        sgapSession,
        sgapDriver,
        page,
        betCount: 1,
        perBetTimeoutMs: 90_000,
      });
      const firstBetResponse = firstBets[0]!;
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(true);

      const stakeBeforeNudge = stakeFromBetResponse(firstBetResponse);
      expect(stakeBeforeNudge, 'autoplay bet stake').toBeDefined();

      const followUpBets = await watchBetResponsesDuring(
        page,
        async () => {
          await sgapDriver
            .clickCanvas('amplifyBet', { timeoutMs: 10_000, singleInput: true })
            .catch(() => undefined);
          await sgapDriver
            .clickCanvas('betPlus', { timeoutMs: 10_000, singleInput: true })
            .catch(() => undefined);
          await sgapDriver
            .clickCanvas('betPlus', { timeoutMs: 10_000, singleInput: true })
            .catch(() => undefined);

          const buyWatch = sawBuyPurchaseWithin(page, 3_000);
          await sgapDriver
            .clickCanvas('buyFeature', { timeoutMs: 10_000, singleInput: true })
            .catch(() => undefined);
          await sgapDriver
            .clickCanvas('buyFeatureConfirm', { timeoutMs: 10_000, singleInput: true })
            .catch(() => undefined);
          await sgapDriver
            .clickCanvas('buyFeatureCancel', { timeoutMs: 8_000, singleInput: true })
            .catch(() => undefined);
          const sawBuy = await buyWatch;

          verificationResults.push({
            kind: 'bet',
            passed: !sawBuy,
            message: sawBuy
              ? 'Buy purchase fired during autoplay (expected disabled)'
              : 'Buy Feature disabled during autoplay',
          });
        },
        { minCount: 1, timeoutMs: 90_000, settleMs: 500 },
      );

      const continued =
        followUpBets.length > 0 || sgapSession.autoplay.isAutoplayActive();
      expect(continued, 'autoplay should continue after mid taps').toBe(true);

      const afterBet = followUpBets.at(-1) ?? firstBetResponse;
      const stakeAfterNudge = stakeFromBetResponse(afterBet);
      const betLocked =
        stakeAfterNudge !== undefined &&
        Math.abs(Number(stakeAfterNudge) - Number(stakeBeforeNudge)) <= 0.001;
      verificationResults.push({
        kind: 'bet',
        passed: betLocked,
        message: betLocked
          ? `Bet locked during autoplay (stake still ${stakeAfterNudge})`
          : `Bet +/- applied during autoplay: before=${stakeBeforeNudge}, after=${stakeAfterNudge}`,
        expected: stakeBeforeNudge,
        actual: stakeAfterNudge,
      });

      await stopAutoplayQuietly(sgapSession, page);
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(false);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, {
        forceGridSpam: true,
      });

      await sgapSession.amplifyBet.enable({ timeoutMs: 15_000 });
      expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(true);
      await sgapSession.amplifyBet.disable({ timeoutMs: 15_000 });
      expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(false);
      verificationResults.push({
        kind: 'bet',
        passed: true,
        message: 'Amplify toggles again after autoplay stop',
      });

      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 });
      await sgapDriver
        .clickCanvas('buyFeatureCancel', { timeoutMs: 15_000, singleInput: true })
        .catch(() => undefined);
      verificationResults.push({
        kind: 'bet',
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
      await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
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
