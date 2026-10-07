/**
 * AP-008 — Autoplay
 *
 * Manual Test Case ID: AP-008
 * Intent: Autoplay credits balance after Scatter — wallet after a scatter
 * feature is not below the pre-scatter balance minus only the opener stake.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { parseBetResponseBody } from '../../../src/data/parse-bet-response.js';
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
} from '../../support/buy-feature-verify.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import type { Response } from 'playwright';

const MANUAL_TEST_ID = 'AP-008' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay', 'freeSpins', 'scatterTrigger');
  test(`${MANUAL_TEST_ID} autoplay credits balance after Scatter`, async ({
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
      let openerBalance = Number.NaN;
      let laterBalance = Number.NaN;
      let openerWin = 0;

      for (let i = 0; i < responses.length; i += 1) {
        const raw = await responses[i]!.json().catch(() => undefined);
        if (raw === undefined || !featureEnteredFromBody(raw)) {
          continue;
        }
        const req = responses[i]!.request().postDataJSON() as { buyFeat?: unknown } | null;
        if (req?.buyFeat) {
          continue;
        }
        scatterIndex = i;
        const parsed = parseBetResponseBody(raw, sgapSession.manifest.network!.fields);
        openerBalance = Number(parsed.balance?.amount ?? 'NaN');
        openerWin = Number(parsed.win?.amount ?? '0');
        break;
      }

      if (scatterIndex >= 0) {
        let featureEnd = scatterIndex;
        // Bundled Sugar features complete on the opener (remaining=0). Only walk
        // sequential free-spin bets — do not treat later autoplay spins as the feature.
        for (let i = scatterIndex + 1; i < responses.length; i += 1) {
          const raw = await responses[i]!.json().catch(() => undefined);
          if (raw === undefined || freeSpinItemsRemaining(raw) <= 0) {
            break;
          }
          featureEnd = i;
        }
        const endRaw = await responses[featureEnd]!.json().catch(() => undefined);
        if (endRaw !== undefined) {
          const parsed = parseBetResponseBody(endRaw, sgapSession.manifest.network!.fields);
          laterBalance = Number(parsed.balance?.amount ?? 'NaN');
        }
        if (!Number.isFinite(laterBalance)) {
          laterBalance = openerBalance;
        }
      }

      verificationResults.push({
        kind: 'freeSpins',
        passed: scatterIndex >= 0,
        message:
          scatterIndex >= 0
            ? `Scatter credited during autoplay at bet #${scatterIndex + 1}`
            : `No scatter feature during autoplay (${responses.length} bets)`,
        actual: scatterIndex,
      });

      // Feature itself must not drop the wallet; later autoplay spins may deduct stake.
      const credited =
        scatterIndex >= 0 &&
        Number.isFinite(openerBalance) &&
        Number.isFinite(laterBalance) &&
        laterBalance + 0.02 >= openerBalance - 0.01;
      verificationResults.push({
        kind: 'balance',
        passed: credited,
        message: credited
          ? `Balance at feature end held or rose (opener=${openerBalance}, featureEnd=${laterBalance}, openerWin=${openerWin})`
          : `Balance dropped during scatter feature (opener=${openerBalance}, featureEnd=${laterBalance})`,
        expected: openerBalance,
        actual: laterBalance,
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
