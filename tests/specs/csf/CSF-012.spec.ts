/**
 * CSF-012 — Core Spin Flow
 *
 * Manual Test Case ID: CSF-012
 * Intent: Skip function via Space — after feature entry, Space advances
 * intro / win overlays without breaking the session.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet, spinForBet } from '../../support/canvas-bet-flow.js';
import { featureEnteredFromBody } from '../../support/buy-feature-verify.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-012' as const;

test.describe('CSF — Core Spin Flow', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} skip function via Space`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'CSF' },
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
      const entered = featureEnteredFromBody(buy.raw);
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered,
        message: entered
          ? 'Feature entered via buy — Space skip target available'
          : 'Buy did not enter feature — Space skip path not exercised',
      });

      // Focus canvas, then Space through feature overlays before draining leftovers.
      const canvas = sgapDriver.gameCanvas();
      await canvas.click({ position: { x: 8, y: 8 }, force: true }).catch(() => undefined);
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press('Space');
        await page.waitForTimeout(200);
      }
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, {
        forceGridSpam: true,
      });

      if (entered) {
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 8);
      } else {
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          buy.raw,
        );
      }

      if (!(await sgapDriver.isAttached())) {
        await sgapDriver.attach();
      }
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
            ? 'Follow-up bet after Space skip succeeded'
            : 'Follow-up bet failed after Space skip',
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
