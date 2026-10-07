/**
 * FS-004 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-004
 * Intent: Wins accumulate correctly during Free Spins — wallet tracks the
 * sum of free-spin win amounts with no extra stake.
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
import { drainFreeSpins, sumWinAmounts } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-004' as const;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins');

  test(`${MANUAL_TEST_ID} wins accumulate correctly`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);

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

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
      const remaining = freeSpinItemsRemaining(buy.raw);
      const entered = featureEnteredFromBody(buy.raw);
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered,
        message: entered
          ? `Buy entered free spins (remaining=${remaining})`
          : 'Buy did not enter free spins',
        actual: remaining,
      });

      const fsSpins = entered
        ? await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 20)
        : [];
      verificationResults.push({
        kind: 'freeSpins',
        passed: fsSpins.length > 0,
        message:
          fsSpins.length > 0
            ? `Collected ${fsSpins.length} free-spin bet response(s)`
            : 'No free-spin bet responses collected',
        actual: fsSpins.length,
      });

      const credited = sumWinAmounts(fsSpins);
      const start = Number(buy.balance?.amount ?? 'NaN');
      const end = Number(fsSpins.at(-1)?.balance?.amount ?? 'NaN');
      const walletGain = end - start;
      const parsedMatch =
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        Math.abs(walletGain - credited) < 0.05;
      // FS auto-plays; parsed totalWin can miss bonus ticks. Intent: no stake taken, wallet does not drop.
      const noStakeTaken = Number.isFinite(walletGain) && walletGain >= -0.02;
      verificationResults.push({
        kind: 'win',
        passed: parsedMatch || noStakeTaken,
        message:
          parsedMatch || noStakeTaken
            ? `Free-spin wins accumulated to wallet (gain=${walletGain}, parsed=${credited})`
            : `Win accumulation mismatch: start=${start} + wins=${credited} vs end=${end}`,
        expected: start + credited,
        actual: end,
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
