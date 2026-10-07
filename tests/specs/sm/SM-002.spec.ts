/**
 * SM-002 — State Management
 *
 * Manual Test Case ID: SM-002
 * Regression meaning: Bet modal must not be accessible during spin — if bet
 * can still change mid-spin, the test fails.
 */

import { test, expect } from '../../fixtures/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  nudgeUntilStakeChanges,
  spinForStake,
  spinWithMidSpinBetNudge,
} from '../../support/canvas-bet-control.js';

const MANUAL_TEST_ID = 'SM-002' as const;

test.describe('SM — State Management', () => {
  test(`${MANUAL_TEST_ID} cannot change bet during spin`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'SM' },
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

      const inFlightStake = await spinWithMidSpinBetNudge(
        sgapSession,
        sgapDriver,
        'increase',
        3,
        page,
      );

      const lockedDuringSpin =
        Math.abs(Number(inFlightStake) - Number(beforeStake)) <= 0.001;
      verificationResults.push({
        kind: 'stateManagement',
        passed: lockedDuringSpin,
        message: lockedDuringSpin
          ? `Bet locked during spin (stake still ${inFlightStake})`
          : `Bet changed mid-spin: before=${beforeStake}, inFlight=${inFlightStake}`,
        expected: beforeStake,
        actual: inFlightStake,
      });

      const nextStake = await spinForStake(sgapSession, sgapDriver, page);
      const nextUnchanged =
        Math.abs(Number(nextStake) - Number(beforeStake)) <= 0.001;
      verificationResults.push({
        kind: 'stateManagement',
        passed: nextUnchanged,
        message: nextUnchanged
          ? `Next spin kept locked stake: ${nextStake}`
          : `Mid-spin +/- stuck after settle: before=${beforeStake}, next=${nextStake}`,
        expected: beforeStake,
        actual: nextStake,
      });

      const idleRaised = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'increase',
        nextStake,
        5,
        page,
      );
      const unlocksWhenIdle = Number(idleRaised) > Number(nextStake);
      verificationResults.push({
        kind: 'stateManagement',
        passed: unlocksWhenIdle,
        message: unlocksWhenIdle
          ? `Bet unlocks when idle: ${nextStake} → ${idleRaised}`
          : `Bet still locked when idle: ${nextStake} → ${idleRaised}`,
        expected: `> ${nextStake}`,
        actual: idleRaised,
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
