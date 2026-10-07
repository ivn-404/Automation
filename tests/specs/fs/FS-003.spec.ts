/**
 * FS-003 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-003
 * Intent: No bet deduction during Free Spins — after Buy Feature, FS spins
 * credit wins without subtracting stake.
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
import { drainFreeSpins, stakeDeducted } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-003' as const;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins');

  test(`${MANUAL_TEST_ID} no bet deduction during Free Spins`, async ({
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
        ? await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24)
        : [];
      verificationResults.push({
        kind: 'freeSpins',
        passed: fsSpins.length > 0,
        message:
          fsSpins.length > 0
            ? `Collected ${fsSpins.length} free-spin response(s)`
            : 'No free-spin responses collected',
        actual: fsSpins.length,
      });

      let before = buy.balance?.amount;
      let maxDeduction = 0;
      let computed = 0;
      for (const spin of fsSpins) {
        // Bundled buy items share the post-buy balance — skip delta math there.
        if (
          spin.raw &&
          typeof spin.raw === 'object' &&
          '__sgapBundledItemIndex' in (spin.raw as object)
        ) {
          continue;
        }
        const deducted = stakeDeducted(before, spin);
        if (Number.isFinite(deducted)) {
          computed += 1;
          maxDeduction = Math.max(maxDeduction, deducted);
        }
        before = spin.balance?.amount ?? before;
      }
      const bundledOnly = computed === 0 && fsSpins.length > 0;
      verificationResults.push({
        kind: 'balance',
        passed: bundledOnly || (computed > 0 && maxDeduction < 0.02),
        message: bundledOnly
          ? `Bundled free spins resolved in buy payload (no per-spin stake deduction)`
          : computed > 0 && maxDeduction < 0.02
            ? `Free spins did not deduct stake (max observed deduction=${maxDeduction})`
            : computed === 0
              ? 'Could not compute free-spin balance delta'
              : `Free spin deducted stake (${maxDeduction})`,
        expected: '< 0.02',
        actual: bundledOnly ? 0 : maxDeduction,
      });

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      if (entered) {
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        );
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
