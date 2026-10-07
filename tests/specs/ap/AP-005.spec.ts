/**
 * AP-005 — Autoplay
 *
 * Manual Test Case ID: AP-005
 * Intent: after a lightning tap, autoplay still sends /bet and a spin after
 * stop still completes. Turbo-on is not on the POST body.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { expectNoBetWithin, spinForBet } from '../../support/canvas-bet-flow.js';
import {
  prepareAutoplayCanvas,
  startAutoplayCollectingBets,
  stopAutoplayQuietly,
  verifyAutoplayProducedBets,
} from '../../support/autoplay-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';

const MANUAL_TEST_ID = 'AP-005' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay', 'turbo');

  test(`${MANUAL_TEST_ID} autoplay still sends /bet after lightning tap`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

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
      await expect(sgapSession.turbo.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      // Lightning first (via prepareAutoplayCanvas), then shared start+collect —
      // avoids racing a 60s waiter against autoplay.start's own confirm /bet.
      await prepareAutoplayCanvas(
        sgapSession,
        sgapDriver,
        page,
        sgapSession.platform.getInitializeBody(),
      );

      const betResponses = await startAutoplayCollectingBets({
        sgapSession,
        sgapDriver,
        page,
        betCount: 2,
        perBetTimeoutMs: 90_000,
        startTimeoutMs: 30_000,
        spinCountAction: 'autoplaySpins10',
      });
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(true);

      verificationResults.push(verifyAutoplayProducedBets(betResponses));

      await stopAutoplayQuietly(sgapSession, page);
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(false);

      await page
        .waitForResponse(
          (response) => response.ok() && matchesBetUrl(response.url()),
          { timeout: 8_000 },
        )
        .catch(() => undefined);
      await expectNoBetWithin(page, 4_000);

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
      await stopAutoplayQuietly(sgapSession, page);
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
