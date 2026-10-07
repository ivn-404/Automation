/**
 * BC-002 — Bet Control
 *
 * Manual Test Case ID: BC-002
 * Intent: player can decrease bet; subsequent spin uses a lower stake.
 */

import { test, expect } from '../../fixtures/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { nudgeUntilStakeChanges, spinForStake } from '../../support/canvas-bet-control.js';

const MANUAL_TEST_ID = 'BC-002' as const;

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} player can decrease bet and spin with lower stake`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'BC' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.bet.isAvailable()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const startStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(startStake);

      const raisedStake = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'increase',
        startStake,
        7,
        page,
      );
      expect(Number(raisedStake), 'need raised stake before decrease').toBeGreaterThan(
        Number(startStake),
      );

      const loweredStake = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'decrease',
        raisedStake,
        7,
        page,
      );

      const passed = Number(loweredStake) < Number(raisedStake);
      verificationResults = [
        {
          kind: 'bet',
          passed,
          message: passed
            ? `Stake decreased: ${raisedStake} → ${loweredStake}`
            : `Stake did not decrease: raised=${raisedStake}, after=${loweredStake}`,
          expected: `< ${raisedStake}`,
          actual: loweredStake,
        },
      ];

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
