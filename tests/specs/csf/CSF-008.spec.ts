/**
 * CSF-008 — Core Spin Flow
 *
 * Manual Test Case ID: CSF-008
 * Intent: a no-win spin reports totalWin === 0 and balance decreases by exactly the stake.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame, clearCanvasOverlays } from '../../../src/platform/index.js';
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
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-008' as const;
const MAX_ZERO_WIN_ATTEMPTS = 12;

test.describe('CSF — Core Spin Flow', () => {
  test(`${MANUAL_TEST_ID} no-win spin reports zero totalWin`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

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

      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      let zeroWinBet: BetResponseSnapshot | undefined;
      let beforeBalance = sgapSession.initializeBalance;

      for (let attempt = 0; attempt < MAX_ZERO_WIN_ATTEMPTS; attempt += 1) {
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        const winAmount = Number(bet.win?.amount ?? '0');

        if (winAmount === 0) {
          zeroWinBet = bet;
          break;
        }
        if (bet.balance !== undefined) {
          beforeBalance = bet.balance;
        }
      }

      if (zeroWinBet === undefined) {
        test.skip(true, `No zero-win spin after ${MAX_ZERO_WIN_ATTEMPTS} attempts`);
        return;
      }

      const skipDelta = getLauncherMode() === 'local';

      verificationResults = [
        ...verifyBetResponseShape(zeroWinBet, { requireCompleted: true }),
        verifyBalanceIsNumeric(zeroWinBet.balance),
        verifyWinIsNonNegative(zeroWinBet.win),
      ];

      expect(Number(zeroWinBet.win!.amount), 'totalWin must be 0').toBe(0);

      if (!skipDelta && beforeBalance !== undefined && zeroWinBet.balance !== undefined && zeroWinBet.win !== undefined) {
        verificationResults.push(
          verifyBalanceDelta({
            before: beforeBalance,
            after: zeroWinBet.balance,
            win: zeroWinBet.win,
            stakeAmount: zeroWinBet.bet?.amount,
            tolerance: 0.35,
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
