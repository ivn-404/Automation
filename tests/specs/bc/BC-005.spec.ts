/**
 * BC-005 — Bet Control
 *
 * Manual Test Case ID: BC-005
 * Intent: bet is locked during spin(s) — mid-spin +/- must not change next stake.
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

const MANUAL_TEST_ID = 'BC-005' as const;

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} bet is locked during spin`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

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

      const beforeStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(beforeStake);

      const inFlightStake = await spinWithMidSpinBetNudge(
        sgapSession,
        sgapDriver,
        'increase',
        3,
        page,
      );

      const inFlightLocked =
        Math.abs(Number(inFlightStake) - Number(beforeStake)) <= 0.001;
      verificationResults.push({
        kind: 'bet',
        passed: inFlightLocked,
        message: inFlightLocked
          ? `In-flight stake unchanged during mid-spin +/-: ${inFlightStake}`
          : `In-flight stake changed mid-spin: before=${beforeStake}, inFlight=${inFlightStake}`,
        expected: beforeStake,
        actual: inFlightStake,
      });

      const afterMidSpinStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(afterMidSpinStake);

      const stillLocked =
        Math.abs(Number(afterMidSpinStake) - Number(beforeStake)) <= 0.001;
      verificationResults.push({
        kind: 'bet',
        passed: stillLocked,
        message: stillLocked
          ? `Next spin kept stake after mid-spin +/- ignored: ${afterMidSpinStake}`
          : `Mid-spin +/- stuck: before=${beforeStake}, next=${afterMidSpinStake}`,
        expected: beforeStake,
        actual: afterMidSpinStake,
      });

      const idleRaised = await nudgeUntilStakeChanges(
        sgapSession,
        sgapDriver,
        'increase',
        afterMidSpinStake,
        5,
        page,
      );
      const unlockWorks = Number(idleRaised) > Number(afterMidSpinStake);
      verificationResults.push({
        kind: 'bet',
        passed: unlockWorks,
        message: unlockWorks
          ? `Bet unlocks when idle: ${afterMidSpinStake} → ${idleRaised}`
          : `Bet still stuck after idle: ${afterMidSpinStake} → ${idleRaised}`,
        expected: `> ${afterMidSpinStake}`,
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
