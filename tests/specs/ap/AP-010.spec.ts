/**
 * AP-010 — Autoplay
 *
 * Manual Test Case ID: AP-010
 * Intent: Returns to Autoplay after Free Spins / retrigger — once a scatter
 * feature opened during autoplay finishes, further autoplay bets still arrive.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import {
  prepareAutoplayCanvas,
  startAutoplayCountingUntilIdle,
  stopAutoplayQuietly,
  isBetResponse,
} from '../../support/autoplay-flow.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
  isFreeSpinBundleComplete,
} from '../../support/buy-feature-verify.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import type { Response } from 'playwright';

const MANUAL_TEST_ID = 'AP-010' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay', 'freeSpins', 'scatterTrigger');
  test(`${MANUAL_TEST_ID} returns to Autoplay after Free Spins`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(900_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AP' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];
    const responses: Response[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await prepareAutoplayCanvas(sgapSession, sgapDriver, page);
      if (await sgapSession.amplifyBet.isAvailable()) {
        await sgapSession.amplifyBet.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      }

      const onResponse = (response: Response): void => {
        if (response.ok() && isBetResponse(response.url())) {
          responses.push(response);
        }
      };
      page.on('response', onResponse);

      try {
        await startAutoplayCountingUntilIdle({
          sgapSession,
          sgapDriver,
          page,
          countOptions: {
            maxBets: 55,
            idleMs: 45_000,
            firstBetTimeoutMs: 90_000,
            overallTimeoutMs: 650_000,
          },
        });
      } finally {
        page.off('response', onResponse);
        await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
      }

      let featureStart = -1;
      let featureEnd = -1;

      for (let i = 0; i < responses.length; i += 1) {
        const raw = await responses[i]!.json().catch(() => undefined);
        if (raw === undefined) {
          continue;
        }
        const req = responses[i]!.request().postDataJSON() as { buyFeat?: unknown } | null;
        if (req?.buyFeat) {
          continue;
        }
        if (featureStart < 0 && featureEnteredFromBody(raw)) {
          featureStart = i;
          if (isFreeSpinBundleComplete(raw) || freeSpinItemsRemaining(raw) === 0) {
            featureEnd = i;
          }
          continue;
        }
        if (featureStart >= 0 && featureEnd < 0) {
          if (freeSpinItemsRemaining(raw) === 0 && !featureEnteredFromBody(raw)) {
            featureEnd = i - 1;
          } else if (isFreeSpinBundleComplete(raw)) {
            featureEnd = i;
          }
        }
      }
      if (featureStart >= 0 && featureEnd < 0) {
        featureEnd = featureStart;
      }

      verificationResults.push({
        kind: 'freeSpins',
        passed: featureStart >= 0,
        message:
          featureStart >= 0
            ? `Feature opened during autoplay at bet #${featureStart + 1}`
            : `No free-spin feature during autoplay (${responses.length} bets)`,
        actual: featureStart,
      });

      const resumed = featureEnd >= 0 && responses.length > featureEnd + 1;
      verificationResults.push({
        kind: 'stateManagement',
        passed: resumed,
        message: resumed
          ? `Autoplay resumed after feature ` +
            `(${responses.length - featureEnd - 1} bet(s) after index ${featureEnd})`
          : featureStart < 0
            ? 'Skipped resume check — no feature observed'
            : 'No autoplay bets after the feature session ended',
        actual: featureEnd >= 0 ? responses.length - featureEnd - 1 : 0,
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
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'failed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: message,
        verificationResults,
      });
      throw error;
    } finally {
      await sgapSession.amplifyBet.disable({ timeoutMs: 10_000 }).catch(() => undefined);
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
