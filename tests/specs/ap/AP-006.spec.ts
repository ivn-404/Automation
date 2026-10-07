/**
 * AP-006 — Autoplay
 *
 * Manual Test Case ID: AP-006
 * Intent: Autoplay continues when Scatter triggers — feature entry during
 * autoplay does not permanently stop the autoplay session.
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
import { featureEnteredFromBody } from '../../support/buy-feature-verify.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import type { Response } from 'playwright';

const MANUAL_TEST_ID = 'AP-006' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} autoplay continues when Scatter triggers`, async ({
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
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);

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

      let betCount = 0;
      try {
        betCount = await startAutoplayCountingUntilIdle({
          sgapSession,
          sgapDriver,
          page,
          countOptions: {
            maxBets: 50,
            idleMs: 45_000,
            firstBetTimeoutMs: 90_000,
            overallTimeoutMs: 600_000,
          },
        });
      } finally {
        page.off('response', onResponse);
        await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
      }

      let scatterIndex = -1;
      for (let i = 0; i < responses.length; i += 1) {
        const body = await responses[i]!.json().catch(() => undefined);
        if (body !== undefined && featureEnteredFromBody(body)) {
          const req = responses[i]!.request().postDataJSON() as { buyFeat?: unknown } | null;
          if (req?.buyFeat) {
            continue;
          }
          scatterIndex = i;
          break;
        }
      }

      verificationResults.push({
        kind: 'freeSpins',
        passed: scatterIndex >= 0,
        message:
          scatterIndex >= 0
            ? `Scatter/feature opened during autoplay at bet #${scatterIndex + 1}/${responses.length}`
            : `No scatter feature during autoplay (${responses.length} bets, counted=${betCount})`,
        actual: { scatterIndex, bets: responses.length, betCount },
      });

      const continued =
        scatterIndex >= 0 && responses.length > scatterIndex + 1;
      verificationResults.push({
        kind: 'stateManagement',
        passed: continued,
        message: continued
          ? `Autoplay continued after scatter (${responses.length - scatterIndex - 1} later bet(s))`
          : scatterIndex < 0
            ? 'Skipped continue check — no scatter observed'
            : 'Autoplay produced no bets after the scatter opener',
        actual: responses.length - scatterIndex - 1,
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
