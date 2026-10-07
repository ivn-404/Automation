/**
 * BC-006 — Bet Control
 *
 * Manual Test Case ID: BC-006
 * Intent: bet value selected in UI matches the stake sent on the backend bet request.
 */

import { test, expect } from '../../fixtures/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import {
  nudgeUntilStakeChanges,
  resolveBetLevels,
  spinForStake,
} from '../../support/canvas-bet-control.js';

const MANUAL_TEST_ID = 'BC-006' as const;

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} bet value matches backend request`, async ({
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

      const { levels } = resolveBetLevels(sgapSession);

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

      const changed = Number(afterStake) > Number(beforeStake);
      verificationResults.push({
        kind: 'bet',
        passed: changed,
        message: changed
          ? `Backend request stake changed with UI: ${beforeStake} → ${afterStake}`
          : `Backend request stake did not follow UI increase: before=${beforeStake}, after=${afterStake}`,
        expected: `> ${beforeStake}`,
        actual: afterStake,
      });

      const onLadder = levels.some(
        (level) => Math.abs(level - Number(afterStake)) <= 0.001,
      );
      verificationResults.push({
        kind: 'bet',
        passed: onLadder,
        message: onLadder
          ? `Backend stake is on bet ladder: ${afterStake}`
          : `Backend stake ${afterStake} not in betLevels [${levels.join(', ')}]`,
        expected: 'member of betLevels',
        actual: afterStake,
      });

      // Win / tumble overlays often follow an increase spin — settle before decrease.
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const lowered = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'decrease',
        afterStake,
        getLauncherMode() === 'staging' ? 7 : 5,
        page,
      );
      const decreased = Number(lowered) < Number(afterStake);
      verificationResults.push({
        kind: 'bet',
        passed: decreased,
        message: decreased
          ? `Backend request stake follows UI decrease: ${afterStake} → ${lowered}`
          : `Backend request stake did not follow UI decrease: raised=${afterStake}, after=${lowered}`,
        expected: `< ${afterStake}`,
        actual: lowered,
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
