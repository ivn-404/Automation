/**
 * ES-004 — Edge & Stability
 *
 * Manual Test Case ID: ES-004
 * Intent: Bonus skip function via click — after feature/bonus entry, skip taps
 * advance past intro without breaking the session.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  clearCanvasOverlays,
  settleCanvasToBaseGame,
  spamClickSkip,
} from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet, spinForBet } from '../../support/canvas-bet-flow.js';
import { featureEnteredFromBody } from '../../support/buy-feature-verify.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-004' as const;

test.describe('ES — Edge & Stability', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} bonus skip function via click`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
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
      const featureActive = featureEnteredFromBody(buy.raw);
      verificationResults.push({
        kind: 'stateManagement',
        passed: featureActive,
        message: featureActive
          ? 'Bonus / free-spin session entered via buy (skip target available)'
          : 'Buy did not enter bonus — skip path not exercised',
      });

      await spamClickSkip(sgapDriver, sgapSession.manifest, 8, { force: true });
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8, {
        forceGridSpam: true,
      });

      if (featureActive) {
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 8);
      } else {
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          buy.raw,
        );
      }

      const available = await sgapSession.spin.isAvailable();
      verificationResults.push({
        kind: 'stateManagement',
        passed: available,
        message: available
          ? 'Session responsive after bonus skip clicks'
          : 'Spin unavailable after bonus skip clicks',
        expected: true,
        actual: available,
      });

      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: followUp.balance !== undefined,
        message:
          followUp.balance !== undefined
            ? 'Follow-up bet after bonus skip succeeded'
            : 'Follow-up bet failed after bonus skip',
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
