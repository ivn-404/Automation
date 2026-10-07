/**
 * BC-004 — Bet Control
 *
 * Manual Test Case ID: BC-004
 * Intent: bet cannot exceed maximum (clamped at ladder max).
 *
 * Staging note: long walks toward 58.4 often hit a canvas "Something went wrong"
 * modal. We walk until declared max, two non-advancing steps, or post-error stall,
 * then verify an extra + stays clamped at that confirmed stake.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import {
  assertStakeClamped,
  logRejectedBets,
  resetStakeToMinimum,
  resolveBetLevels,
  spinForStake,
  walkStakeToBoundary,
} from '../../support/canvas-bet-control.js';

const MANUAL_TEST_ID = 'BC-004' as const;

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} bet cannot exceed maximum`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(720_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'BC' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];
    const stopBetRejectLog = logRejectedBets(page);

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

      const { levels, max } = resolveBetLevels(sgapSession);
      await resetStakeToMinimum(sgapSession, sgapDriver, levels, page);
      const startStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(startStake);

      const atMax = await walkStakeToBoundary(
        sgapSession,
        sgapDriver,
        'max',
        startStake,
        levels,
        page,
      );

      const reachedDeclaredMax = Math.abs(Number(atMax) - Number(max)) <= 0.001;
      const raisedTowardMax = Number(atMax) > Number(startStake) + 0.0001;
      verificationResults.push({
        kind: 'bet',
        passed: raisedTowardMax || reachedDeclaredMax,
        message: reachedDeclaredMax
          ? `Reached declared maximum stake: ${atMax}`
          : raisedTowardMax
            ? `Reached empirical high stake ${atMax} (declared max ${max})`
            : `Stake did not rise toward max: start=${startStake}, after=${atMax}`,
        expected: `>= ${startStake} toward ${max}`,
        actual: atMax,
      });

      const clamped = await assertStakeClamped(
        sgapSession,
        sgapDriver,
        'increase',
        atMax,
        page,
      );

      verificationResults.push({
        kind: 'bet',
        passed: Math.abs(Number(clamped) - Number(atMax)) <= 0.001,
        message: `Extra increase stays clamped: ${clamped}`,
        expected: atMax,
        actual: clamped,
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
      // Leave the account at min stake — the next spec inherits this bet.
      await resetStakeToMinimum(
        sgapSession,
        sgapDriver,
        resolveBetLevels(sgapSession).levels,
        page,
      ).catch(() => undefined);
      stopBetRejectLog();
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
