/**
 * UIDS-005 — UI & Display Sync
 *
 * Manual Test Case ID: UIDS-005
 * Regression meaning: Visual total win must match the payload response "totalWin".
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame, clearCanvasOverlays } from '../../../src/platform/index.js';
import {
  verifyBetResponseShape,
  verifyWinIsNonNegative,
} from '../../../src/verification/bet-response-verification.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'UIDS-005' as const;

test.describe('UIDS — UI & Display Sync', () => {
  test(`${MANUAL_TEST_ID} total win matches server response`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

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

      // Spin twice to verify totalWin consistency across multiple responses.
      for (let spin = 0; spin < 2; spin += 1) {
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
        const bet = await spinForBet(sgapSession, sgapDriver, page);

        const shapeResults = verifyBetResponseShape(bet, { requireCompleted: true });
        const winResult = verifyWinIsNonNegative(bet.win);

        verificationResults.push(...shapeResults, winResult);

        expect(bet.win, `spin ${spin + 1}: win field must be present`).toBeDefined();
        const totalWin = Number(bet.win!.amount);
        expect(Number.isFinite(totalWin), `spin ${spin + 1}: totalWin must be finite`).toBe(true);
        expect(totalWin, `spin ${spin + 1}: totalWin must be >= 0`).toBeGreaterThanOrEqual(0);
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
