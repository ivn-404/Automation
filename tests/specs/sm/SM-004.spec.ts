/**
 * SM-004 — State Management
 *
 * Manual Test Case ID: SM-004
 * Regression meaning: After a spin (and when leaving Bonus back to Normal),
 * the game must return to a correct Idle / playable state.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame, clearCanvasOverlays } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'SM-004' as const;

test.describe('SM — State Management', () => {
  test(`${MANUAL_TEST_ID} game returns to idle state after spin`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

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
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      // Spin and wait for bet response (spin settles).
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
      const bet = await spinForBet(sgapSession, sgapDriver, page);

      expect(bet.balance, 'bet response balance must be present').toBeDefined();

      // Dismiss any win overlays so the game returns to base idle state.
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 10);

      // Verify game is back in idle — spin available + not locked.
      const spinAvailable = await sgapSession.spin.isAvailable();
      const lockState = await sgapSession.spin.getLockState();

      verificationResults = [
        {
          kind: 'stateManagement',
          passed: spinAvailable,
          message: spinAvailable
            ? 'Spin is available after spin settled (idle state)'
            : 'Spin is NOT available after spin settled — game did not return to idle',
          expected: true,
          actual: spinAvailable,
        },
        {
          kind: 'stateManagement',
          passed: !lockState.locked,
          message: lockState.locked
            ? `Spin is still locked after settle: ${lockState.reason ?? 'unknown reason'}`
            : 'Spin is unlocked after settle (idle)',
          expected: false,
          actual: lockState.locked,
        },
      ];

      // Second spin to confirm idle state is real (not a one-off).
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
      const bet2 = await spinForBet(sgapSession, sgapDriver, page);
      expect(bet2.balance, 'second spin response balance must be present').toBeDefined();

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 10);

      const spinAvailable2 = await sgapSession.spin.isAvailable();
      verificationResults.push({
        kind: 'stateManagement',
        passed: spinAvailable2,
        message: spinAvailable2
          ? 'Spin available after second spin (consistent idle)'
          : 'Spin NOT available after second spin',
        expected: true,
        actual: spinAvailable2,
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
