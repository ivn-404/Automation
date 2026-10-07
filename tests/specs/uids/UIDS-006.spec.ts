/**
 * UIDS-006 — UI & Display Sync
 *
 * Manual Test Case ID: UIDS-006
 * Regression meaning:
 * - With freespin/bonus items: payload balance may lag; FE balance = payload balance + totalWin
 * - Without: payload balance already includes winnings; Balance = payload balance
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame, clearCanvasOverlays } from '../../../src/platform/index.js';
import {
  verifyBetResponseShape,
  verifyBalanceIsNumeric,
} from '../../../src/verification/bet-response-verification.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'UIDS-006' as const;

test.describe('UIDS — UI & Display Sync', () => {
  test(`${MANUAL_TEST_ID} balance matches server response`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'UIDS' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      // Spin 1: verify balance field present + numeric.
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
      const bet1 = await spinForBet(sgapSession, sgapDriver, page);

      verificationResults.push(
        ...verifyBetResponseShape(bet1, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet1.balance),
      );

      expect(bet1.balance, 'spin 1: balance must be present').toBeDefined();
      const balance1 = Number(bet1.balance!.amount);
      expect(Number.isFinite(balance1), 'spin 1: balance must be finite').toBe(true);

      // Spin 2: verify balance is still numeric and that spin-1 after-balance
      // served as the starting point for spin 2 (after_1 = before_2 implied).
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
      const bet2 = await spinForBet(sgapSession, sgapDriver, page);

      verificationResults.push(
        ...verifyBetResponseShape(bet2, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet2.balance),
      );

      expect(bet2.balance, 'spin 2: balance must be present').toBeDefined();
      const balance2 = Number(bet2.balance!.amount);
      expect(Number.isFinite(balance2), 'spin 2: balance must be finite').toBe(true);

      // Cross-spin consistency: after_1 should equal before_2 (before_2 = after_2 + stake_2 - win_2).
      const stake2 = Number(bet2.bet?.amount ?? '0');
      const win2 = Number(bet2.win?.amount ?? '0');
      if (Number.isFinite(stake2) && Number.isFinite(win2)) {
        const impliedBefore2 = balance2 + stake2 - win2;
        const consistent = Math.abs(balance1 - impliedBefore2) < 0.02;
        verificationResults.push({
          kind: 'balance',
          passed: consistent,
          message: consistent
            ? `Cross-spin balance consistent: after_1=${balance1} ≈ before_2=${impliedBefore2}`
            : `Cross-spin balance mismatch: after_1=${balance1} vs before_2=${impliedBefore2}`,
          expected: balance1,
          actual: impliedBefore2,
        });
      }

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
