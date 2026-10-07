/**
 * BC-001 — Bet Control
 *
 * Manual Test Case ID: BC-001
 * Intent: player can increase bet; subsequent spin uses a higher stake.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { nudgeUntilStakeChanges, spinForStake } from '../../support/canvas-bet-control.js';

const MANUAL_TEST_ID = 'BC-001' as const;

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} player can increase bet and spin with higher stake`, async ({
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

      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const beforeStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(beforeStake);

      const afterStake = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'increase',
        beforeStake,
        getLauncherMode() === 'staging' ? 7 : 5,
        page,
      );

      const passed = Number(afterStake) > Number(beforeStake);
      verificationResults = [
        {
          kind: 'bet',
          passed,
          message: passed
            ? `Stake increased: ${beforeStake} → ${afterStake}`
            : `Stake did not increase: before=${beforeStake}, after=${afterStake}`,
          expected: `> ${beforeStake}`,
          actual: afterStake,
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
