/**
 * CSF-007 — Core Spin Flow
 *
 * Manual Test Case ID: CSF-007
 * Intent: Total Win displays correctly — the bet response totalWin is a finite, non-negative
 * number and, when win > 0, the balance delta accounts for it.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import {
  verifyBetResponseShape,
  verifyBalanceIsNumeric,
  verifyWinIsNonNegative,
  verifyBalanceDelta,
} from '../../../src/verification/bet-response-verification.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-007' as const;

test.describe('CSF — Core Spin Flow', () => {
  test(`${MANUAL_TEST_ID} total win displays correctly`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

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
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const beforeBalance = sgapSession.initializeBalance;
      const bet = await spinForBet(sgapSession, sgapDriver, page);

      const totalWin = Number(bet.win?.amount ?? 'NaN');
      expect(Number.isFinite(totalWin), `totalWin must be a finite number, got "${bet.win?.amount}"`).toBe(true);
      expect(totalWin, 'totalWin must be >= 0').toBeGreaterThanOrEqual(0);

      const skipDelta = getLauncherMode() === 'local';

      verificationResults = [
        ...verifyBetResponseShape(bet, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet.balance),
        verifyWinIsNonNegative(bet.win),
      ];

      if (!skipDelta && beforeBalance !== undefined && bet.balance !== undefined && bet.win !== undefined) {
        verificationResults.push(
          verifyBalanceDelta({
            before: beforeBalance,
            after: bet.balance,
            win: bet.win,
            stakeAmount: bet.bet?.amount,
          }),
        );
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
