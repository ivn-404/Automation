/**
 * BF-008 — Buy Feature
 *
 * Manual Test Case ID: BF-008
 * Intent: Game remains idle during Buy Feature win / intro dialogue
 * (no extra bet), then spin is available/unlocked and a follow-up spin works.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  clearCanvasOverlays,
  freeSpinItemsRemaining,
  settleCanvasToBaseGame,
} from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet, spinForBet } from '../../support/canvas-bet-flow.js';
import { featureTriggeredFromBody } from '../../support/buy-feature-verify.js';
import { dismissDialogConfirm, waitForIdleHud } from '../../support/canvas-healing.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';

const MANUAL_TEST_ID = 'BF-008' as const;

test.describe('BF — Buy Feature', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} idle during Buy Feature win dialogue`, async ({
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

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page, {
        settleAfter: false,
      });
      verificationResults.push({
        kind: 'freeSpins',
        passed: featureTriggeredFromBody(buy.raw),
        message: featureTriggeredFromBody(buy.raw)
          ? 'Buy Feature win / intro dialogue reached'
          : 'Buy did not trigger feature dialogue',
      });

      const extraResponse = await page
        .waitForResponse(
          (response) => response.ok() && matchesBetUrl(response.url()),
          { timeout: 2_500 },
        )
        .catch(() => undefined);
      let extraBetIdle = extraResponse === undefined;
      let extraBetMessage =
        extraResponse === undefined
          ? 'No extra bet while Buy Feature win dialogue is showing (idle)'
          : 'Unexpected bet during Buy Feature win dialogue — game was not idle';
      if (extraResponse !== undefined) {
        const extraBody = await extraResponse.json().catch(() => undefined);
        const featureContinuation =
          extraBody !== undefined &&
          (freeSpinItemsRemaining(extraBody) > 0 || featureTriggeredFromBody(extraBody));
        extraBetIdle = featureContinuation;
        extraBetMessage = featureContinuation
          ? 'Feature continuation bet after buy intro (not a new base purchase)'
          : extraBetMessage;
      }
      verificationResults.push({
        kind: 'stateManagement',
        passed: extraBetIdle,
        message: extraBetMessage,
      });

      await sgapDriver.clickCanvas('enter', { timeoutMs: 8_000, singleInput: true }).catch(() => undefined);
      await dismissDialogConfirm(page, sgapDriver, sgapSession.manifest);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 16_000);

      const available = await sgapSession.spin.isAvailable();
      const lock = await sgapSession.spin.getLockState();
      verificationResults.push({
        kind: 'stateManagement',
        passed: available && !lock.locked,
        message:
          available && !lock.locked
            ? 'Spin idle/unlocked after Buy Feature win dialogue'
            : `Spin not idle after dialogue (available=${available}, locked=${lock.locked})`,
        expected: 'idle',
        actual: lock.locked ? lock.reason ?? 'locked' : 'idle',
      });

      // Under load the feature UI can still cover spin — drain before follow-up.
      await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: followUp.balance !== undefined,
        message:
          followUp.balance !== undefined
            ? 'Follow-up spin after Buy Feature win dialogue succeeded'
            : 'Follow-up spin failed after Buy Feature win dialogue',
        actual: followUp.balance?.amount,
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
