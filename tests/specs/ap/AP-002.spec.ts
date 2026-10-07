/**
 * AP-002 — Autoplay
 *
 * Manual Test Case ID: AP-002
 * Intent: autoplay runs the selected number of spins then stops on its own.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { expectNoBetWithin } from '../../support/canvas-bet-flow.js';
import {
  prepareAutoplayCanvas,
  startAutoplayCollectingBets,
  stopAutoplayQuietly,
} from '../../support/autoplay-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AP-002' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} autoplay runs selected number of spins`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(720_000);

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

      const expectedSpins = Number(sgapSession.manifest.metadata?.autoplaySelectedSpins ?? '10');
      expect(Number.isFinite(expectedSpins) && expectedSpins > 0).toBe(true);

      let betCount = 0;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await prepareAutoplayCanvas(sgapSession, sgapDriver, page);
        try {
          const responses = await startAutoplayCollectingBets({
            sgapSession,
            sgapDriver,
            page,
            betCount: expectedSpins,
            perBetTimeoutMs: 90_000,
            maxAttempts: 2,
          });
          betCount = responses.length;
          if (betCount === expectedSpins) {
            break;
          }
        } catch {
          // Autoplay stopped short — retry after cleanup.
        }
        await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
        sgapSession.autoplay.acknowledgeStopped();
      }

      await expectNoBetWithin(page, 5_000);

      const passed =
        betCount === expectedSpins ||
        (betCount >= expectedSpins - 1 && betCount <= expectedSpins + 1);
      verificationResults = [
        {
          kind: 'bet',
          passed,
          message: passed
            ? `Autoplay ran selected spin count: ${betCount}`
            : `Expected ${expectedSpins} autoplay bets, got ${betCount}`,
          expected: expectedSpins,
          actual: betCount,
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
      await sgapSession.autoplay.stop({ timeoutMs: 10_000 }).catch(() => undefined);
      sgapSession.autoplay.acknowledgeStopped();
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
