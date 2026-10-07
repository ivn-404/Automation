/**
 * CSF-004 — Core Spin Flow
 *
 * Manual Test Case ID: CSF-004
 * Intent: Reels stop correctly (no stuck reel) — a completed bet returns the
 * game to idle, and a follow-up spin still works.
 */

import { test, expect } from '../../fixtures/index.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-004' as const;

test.describe('CSF — Core Spin Flow', () => {
  test(`${MANUAL_TEST_ID} reels stop correctly (no stuck reel)`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'CSF' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(bet, { requireCompleted: true }));

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8);
      const available = await sgapSession.spin.isAvailable();
      const lock = await sgapSession.spin.getLockState();
      verificationResults.push({
        kind: 'stateManagement',
        passed: available && !lock.locked,
        message:
          available && !lock.locked
            ? 'Reels settled to idle after completed spin (not stuck)'
            : `Reels did not settle (available=${available}, locked=${lock.locked})`,
        expected: 'idle',
        actual: lock.locked ? lock.reason ?? 'locked' : 'idle',
      });

      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: followUp.balance !== undefined,
        message:
          followUp.balance !== undefined
            ? 'Follow-up spin after reel settle succeeded'
            : 'Follow-up spin failed — reels may be stuck',
        actual: followUp.balance?.amount,
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
