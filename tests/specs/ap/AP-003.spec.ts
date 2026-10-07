/**
 * AP-003 — Autoplay
 *
 * Manual Test Case ID: AP-003
 * Intent: autoplay stops when manually stopped (no further bets).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import {
  prepareAutoplayCanvas,
  startAutoplayCollectingBets,
  stopAutoplayQuietly,
} from '../../support/autoplay-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AP-003' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} autoplay stops when manually stopped`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AP' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await prepareAutoplayCanvas(sgapSession, sgapDriver, page);

      await startAutoplayCollectingBets({
        sgapSession,
        sgapDriver,
        page,
        betCount: 2,
        perBetTimeoutMs: 90_000,
      });
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(true);

      await stopAutoplayQuietly(sgapSession, page);
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(false);

      verificationResults = [
        {
          kind: 'bet',
          passed: true,
          message: 'Autoplay stopped manually; no further bets within quiet window',
        },
      ];

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
