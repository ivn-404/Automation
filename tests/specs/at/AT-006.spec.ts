/**
 * AT-006 — Additional Test
 *
 * Manual Test Case ID: AT-006
 * Intent: Spin continuation after refreshed Free Spin session — buy into FS,
 * reload the host, and remaining free spins still play.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays, settleCanvasToBaseGame, spamClickSkip } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet, spinForBet } from '../../support/canvas-bet-flow.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
  isFreeSpinBundleComplete,
} from '../../support/buy-feature-verify.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import { reloadAndReopenGame } from '../../support/game-reload.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-006' as const;

test.describe('AT — Additional Test', () => {
  requireCapabilities('buyFeature', 'freeSpins');

  test(`${MANUAL_TEST_ID} spin continuation after refreshed Free Spin session`, async ({
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

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page, {
        settleAfter: false,
      });
      const remainingBefore = freeSpinItemsRemaining(buy.raw);
      const bundled = isFreeSpinBundleComplete(buy.raw);
      const entered = featureEnteredFromBody(buy.raw);
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered,
        message: entered
          ? `Buy entered free spins (remaining=${remainingBefore}, bundled=${bundled})`
          : 'Buy did not enter free spins — cannot refresh a FS session',
        actual: remainingBefore,
      });

      // Mid-feature: one in-feature spin when sequential; brief UI skip when bundled.
      let mid = buy;
      if (remainingBefore > 0) {
        mid = await spinForBet(sgapSession, sgapDriver, page);
      } else if (entered) {
        await spamClickSkip(sgapDriver, sgapSession.manifest, 6, { force: true });
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, {
          forceGridSpam: true,
        });
      }
      verificationResults.push({
        kind: 'bet',
        passed: mid.balance !== undefined,
        message:
          mid.balance !== undefined
            ? `Free-spin session active before refresh (balance=${mid.balance.amount})`
            : 'Could not establish free-spin session before refresh',
        actual: mid.balance?.amount,
      });

      await spamClickSkip(sgapDriver, sgapSession.manifest, 4, { force: true });
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, { forceGridSpam: true });

      await reloadAndReopenGame({
        sgapSession,
        sgapDriver,
        page,
        preserveFeatureSession: true,
      });

      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      // Bundled buys report remaining=0, so settleCanvasToBaseGame no-ops and
      // leaves the feature overlay up. Drain the restored FS UI, then spin.
      await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
      const idleAfterDrain = await waitForIdleHud(
        page,
        sgapDriver,
        sgapSession.manifest,
        30_000,
      );
      if (!idleAfterDrain.healed) {
        await spamClickSkip(sgapDriver, sgapSession.manifest, 8, { force: true });
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, {
          forceGridSpam: true,
        });
        await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 20_000);
      }
      const continued = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'stateManagement',
        passed: continued.balance !== undefined,
        message:
          continued.balance !== undefined
            ? `Spin continued after refreshed Free Spin session (balance=${continued.balance.amount})`
            : 'Could not spin after refreshed Free Spin session',
        actual: continued.balance?.amount,
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
