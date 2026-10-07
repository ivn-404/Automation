/**
 * TM-003 — Turbo Mode
 *
 * Manual Test Case ID: TM-003
 * Intent: after a lightning tap, autoplay still sends /bet and a spin after
 * stop still completes. Turbo-on is not network-provable — do not use
 * isEnhancedBet.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import {
  prepareAutoplayCanvas,
  startAutoplayCollectingBets,
  stopAutoplayQuietly,
  verifyAutoplayProducedBets,
} from '../../support/autoplay-flow.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';

const MANUAL_TEST_ID = 'TM-003' as const;

test.describe('TM — Turbo Mode', () => {
  requireCapabilities('autoplay', 'turbo');

  test(`${MANUAL_TEST_ID} autoplay still sends /bet after lightning tap`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'TM' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.turbo.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await prepareAutoplayCanvas(sgapSession, sgapDriver, page);

      const betResponses = await startAutoplayCollectingBets({
        sgapSession,
        sgapDriver,
        page,
        betCount: 2,
        perBetTimeoutMs: 90_000,
      });

      verificationResults.push(verifyAutoplayProducedBets(betResponses));

      await stopAutoplayQuietly(sgapSession, page);
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(false);

      const afterStop = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(afterStop, { requireCompleted: true }));

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
      await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
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
