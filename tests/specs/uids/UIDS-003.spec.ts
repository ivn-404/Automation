/**
 * UIDS-003 — UI & Display Sync
 *
 * Manual Test Case ID: UIDS-003
 * Regression meaning: In-game bet must match the /bet payload field "bet".
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

const MANUAL_TEST_ID = 'UIDS-003' as const;

test.describe('UIDS — UI & Display Sync', () => {
  test(`${MANUAL_TEST_ID} bet display matches internal value`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

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
      await expect(sgapSession.bet.isAvailable()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const { levels } = resolveBetLevels(sgapSession);

      const beforeStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(beforeStake);

      const onLadderBefore = levels.some(
        (level) => Math.abs(level - Number(beforeStake)) <= 0.001,
      );
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: onLadderBefore,
        message: onLadderBefore
          ? `Initial stake matches bet ladder: ${beforeStake}`
          : `Initial stake ${beforeStake} not in betLevels [${levels.join(', ')}]`,
        expected: 'member of betLevels',
        actual: beforeStake,
      });

      const afterStake = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'increase',
        beforeStake,
        getLauncherMode() === 'staging' ? 7 : 5,
        page,
      );

      const uiMatchesBackend = Number(afterStake) > Number(beforeStake);
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: uiMatchesBackend,
        message: uiMatchesBackend
          ? `UI bet change reflected in backend stake: ${beforeStake} → ${afterStake}`
          : `UI bet change not reflected: before=${beforeStake}, after=${afterStake}`,
        expected: `> ${beforeStake}`,
        actual: afterStake,
      });

      const onLadderAfter = levels.some(
        (level) => Math.abs(level - Number(afterStake)) <= 0.001,
      );
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: onLadderAfter,
        message: onLadderAfter
          ? `Updated stake still matches bet ladder: ${afterStake}`
          : `Updated stake ${afterStake} not in betLevels [${levels.join(', ')}]`,
        expected: 'member of betLevels',
        actual: afterStake,
      });

      // Observed controller stake should match last backend stake.
      const observed = await sgapSession.bet.getBet();
      const observedMatch =
        Math.abs(Number(observed) - Number(afterStake)) <= 0.001;
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: observedMatch,
        message: observedMatch
          ? `Observed bet matches backend stake: ${observed}`
          : `Observed bet ${observed} != backend ${afterStake}`,
        expected: afterStake,
        actual: observed,
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
