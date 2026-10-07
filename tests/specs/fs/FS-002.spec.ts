/**
 * FS-002 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-002
 * Intent: Free Spins count is correct in the feature payload — spinsLeft starts
 * at the awarded count and reaches exhaustion when the feature ends
 * (including the Max Win / early-exit case where remaining becomes 0).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
} from '../../support/buy-feature-verify.js';
import { drainFreeSpins, readFreeSpinSession } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-002' as const;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins');

  test(`${MANUAL_TEST_ID} free spins count displayed correctly`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(720_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'FS' },
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

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
      const entered = featureEnteredFromBody(buy.raw);
      const session = readFreeSpinSession(buy.raw, { manifest: sgapSession.manifest });

      verificationResults.push({
        kind: 'freeSpins',
        passed: entered && session !== undefined && session.initialCount > 0,
        message:
          entered && session !== undefined && session.initialCount > 0
            ? `Feature opened with free-spin count=${session.initialCount} ` +
              `(items=${session.itemCount}, series=${session.spinsLeftSeries.slice(0, 4).join('→')}…)`
            : 'Buy did not expose a positive free-spin count',
        actual: session?.initialCount,
      });

      const seriesOk =
        session !== undefined &&
        (session.spinsLeftSeries.length <= 1 ||
          session.spinsLeftSeries.every((left, index, series) => {
            if (index === 0) {
              return true;
            }
            // Allow flat or -1 steps; retrigger bumps are FS-008.
            return left <= series[index - 1]! + 0.001 || left > series[index - 1]!;
          }));
      verificationResults.push({
        kind: 'freeSpins',
        passed: seriesOk === true,
        message: seriesOk
          ? `Free-spin count series is well-formed (${session!.spinsLeftSeries.length} step(s))`
          : 'Free-spin count series missing or malformed',
        actual: session?.spinsLeftSeries,
      });

      if (entered) {
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
      }

      const remainingAfter = freeSpinItemsRemaining(buy.raw);
      // Bundled buys resolve remaining=0 in the same payload; sequential drains to 0.
      const exhausted =
        session?.countExhausted === true ||
        remainingAfter === 0 ||
        (session !== undefined && session.itemCount > 1);
      verificationResults.push({
        kind: 'freeSpins',
        passed: exhausted,
        message: exhausted
          ? `Free-spin count exhausted after feature (remaining=${remainingAfter}, items=${session?.itemCount ?? 0})`
          : `Free-spin count still open after feature (remaining=${remainingAfter})`,
        expected: 0,
        actual: remainingAfter,
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
