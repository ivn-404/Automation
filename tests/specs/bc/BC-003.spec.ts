/**
 * BC-003 — Bet Control
 *
 * Manual Test Case ID: BC-003
 * Intent: bet cannot go below minimum (clamped at ladder min).
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
  initialStakeFromSession,
  resolveBetLevels,
  spinForStake,
  walkStakeToBoundary,
} from '../../support/canvas-bet-control.js';

const MANUAL_TEST_ID = 'BC-003' as const;

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} bet cannot go below minimum`, async ({
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

      const { levels, min } = resolveBetLevels(sgapSession);
      const seededStake = initialStakeFromSession(sgapSession);
      const startStake =
        seededStake ?? (await spinForStake(sgapSession, sgapDriver, page));
      sgapSession.bet.observeBet(startStake);

      const atMin = await walkStakeToBoundary(
        sgapSession,
        sgapDriver,
        'min',
        startStake,
        levels,
        page,
      );

      const clampTarget =
        Math.abs(Number(atMin) - Number(min)) <= 0.001 ? min : atMin;

      const reachedMin = Math.abs(Number(atMin) - Number(min)) <= 0.001;
      verificationResults.push({
        kind: 'bet',
        passed: reachedMin,
        message: reachedMin
          ? `Reached minimum stake: ${atMin}`
          : `Expected min ${min}, got ${atMin}`,
        expected: min,
        actual: atMin,
      });

      const clamped = await assertStakeClamped(
        sgapSession,
        sgapDriver,
        'decrease',
        clampTarget,
        page,
      );

      verificationResults.push({
        kind: 'bet',
        passed: Math.abs(Number(clamped) - Number(clampTarget)) <= 0.001,
        message: `Extra decrease stays at min: ${clamped}`,
        expected: clampTarget,
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
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
