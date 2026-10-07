/**
 * CSF-002 — Core Spin Flow (consecutive spins)
 *
 * Manual Test Case ID: CSF-002
 * Intent: player can complete two consecutive base-game spins with verifiable bet responses.
 */

import { test, expect } from '../../fixtures/index.js';
import { resetSpinTrigger, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-002' as const;

test.describe('CSF — Core Spin Flow', () => {
  test(`${MANUAL_TEST_ID} player can complete two consecutive spins`, async ({
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
      expect(sgapSession.betWatcher).toBeDefined();
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      resetSpinTrigger(sgapDriver);

      let beforeBalance =
        getLauncherMode() === 'local'
          ? { amount: '9721.85' }
          : sgapSession.initializeBalance;

      for (let spinIndex = 1; spinIndex <= 2; spinIndex += 1) {
        if (spinIndex > 1) {
          await settleCanvasToBaseGame(
            page,
            sgapDriver,
            sgapSession.manifest,
            sgapSession.platform.getInitializeBody(),
          );
        }
        const bet = await spinForBet(sgapSession, sgapDriver, page);

        const stakeAmount =
          getLauncherMode() === 'local' ? '0' : bet.bet?.amount;

        const spinResults = verifyBetSpinOutcome(bet, {
          requireCompleted: true,
          ...(beforeBalance !== undefined ? { beforeBalance } : {}),
          ...(stakeAmount !== undefined ? { stakeAmount } : {}),
        });

        for (const result of spinResults) {
          expect(result.passed, `spin ${spinIndex}: ${result.message}`).toBe(true);
        }

        verificationResults = [...verificationResults, ...spinResults];
        beforeBalance = bet.balance;
      }

      const lock = await sgapSession.spin.getLockState();
      expect(lock.locked).toBe(false);

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
