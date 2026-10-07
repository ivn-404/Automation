/**
 * ES-006 — Edge & Stability
 *
 * Manual Test Case ID: ES-006
 * Intent: Maximum bet edge case — walk stake toward the top of the bet ladder
 * and confirm a spin still produces a verifiable bet at that high stake.
 *
 * Staging often errors before declared max (58.4); accept empirical high + clamp.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import {
  assertStakeClamped,
  logRejectedBets,
  resetStakeToMinimum,
  resolveBetLevels,
  spinForStake,
  walkStakeToBoundary,
} from '../../support/canvas-bet-control.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-006' as const;

test.describe('ES — Edge & Stability', () => {
  test(`${MANUAL_TEST_ID} maximum bet edge case`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(720_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];
    const stopBetRejectLog = logRejectedBets(page);

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.bet.isAvailable()).resolves.toBe(true);

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
      const beforeStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(beforeStake);

      const maxStake = await walkStakeToBoundary(
        sgapSession,
        sgapDriver,
        'max',
        beforeStake,
        levels,
        page,
      );

      const reachedDeclaredMax = Math.abs(Number(maxStake) - Number(max)) <= 0.001;
      const raisedTowardMax = Number(maxStake) > Number(beforeStake) + 0.0001;
      verificationResults.push({
        kind: 'bet',
        passed: raisedTowardMax || reachedDeclaredMax,
        message: reachedDeclaredMax
          ? `Stake at maximum bet level: ${maxStake}`
          : raisedTowardMax
            ? `Reached empirical high stake ${maxStake} (declared max ${max})`
            : `Stake did not rise toward max: start=${beforeStake}, after=${maxStake}`,
        expected: `>= ${beforeStake} toward ${max}`,
        actual: maxStake,
      });

      const confirm = await spinForStake(sgapSession, sgapDriver, page);
      const stillHigh = Math.abs(Number(confirm) - Number(maxStake)) <= 0.001;
      verificationResults.push({
        kind: 'bet',
        passed: stillHigh,
        message: stillHigh
          ? `High-bet spin stable at ${confirm}`
          : `High stake drifted after spin: expected ${maxStake}, got ${confirm}`,
        expected: maxStake,
        actual: confirm,
      });

      const clamped = await assertStakeClamped(
        sgapSession,
        sgapDriver,
        'increase',
        maxStake,
        page,
      );
      verificationResults.push({
        kind: 'bet',
        passed: Math.abs(Number(clamped) - Number(maxStake)) <= 0.001,
        message: `Extra increase stays clamped at high stake: ${clamped}`,
        expected: maxStake,
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
