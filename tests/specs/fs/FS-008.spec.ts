/**
 * FS-008 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-008
 * Intent: Scatter retriggers correctly during Feature — mid-feature boards can
 * award extra free spins (spinsLeft increases, or ≥4 scatters land after the opener).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import { featureEnteredFromBody } from '../../support/buy-feature-verify.js';
import { drainFreeSpins, readFreeSpinSession } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-008' as const;
const MAX_BUY_ATTEMPTS = 6;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins', 'scatterTrigger', 'freeSpinRetrigger');

  test(`${MANUAL_TEST_ID} scatter retriggers correctly during Feature`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(900_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'FS' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      let retriggered = false;
      let bestMaxScatter = 0;
      let attempts = 0;
      let lastBody: unknown;

      for (let attempt = 1; attempt <= MAX_BUY_ATTEMPTS; attempt += 1) {
        attempts = attempt;
        console.log(
          `[FS-008] buy attempt ${attempt}/${MAX_BUY_ATTEMPTS} — settle to base, then open Buy Feature`,
        );
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        ).catch(() => undefined);

        const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
        lastBody = buy.raw;
        if (!featureEnteredFromBody(buy.raw)) {
          console.log(`[FS-008] attempt ${attempt}: buy response did not enter feature — retrying`);
          continue;
        }

        const session = readFreeSpinSession(buy.raw, { manifest: sgapSession.manifest });
        bestMaxScatter = Math.max(bestMaxScatter, session?.maxScatterOnItem ?? 0);
        const leftSeries = session?.spinsLeftSeries?.join('→') ?? '?';
        console.log(
          `[FS-008] attempt ${attempt}: items=${session?.itemCount ?? 0} ` +
            `maxScatter=${session?.maxScatterOnItem ?? 0} spinsLeft=${leftSeries} ` +
            `retrigger=${session?.hadRetrigger === true}`,
        );
        if (session?.hadRetrigger === true) {
          retriggered = true;
          console.log(`[FS-008] retrigger found — draining feature UI so the mid-feature bump plays out`);
          await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
          break;
        }
        console.log(`[FS-008] no retrigger in this buy payload — draining, then buying again`);
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
      }

      verificationResults.push({
        kind: 'freeSpins',
        passed: retriggered,
        message: retriggered
          ? `Scatter retrigger observed within ${attempts} buy attempt(s) ` +
            `(maxScattersOnItem=${bestMaxScatter})`
          : `No mid-feature retrigger after ${attempts} buy(s) ` +
            `(maxScattersOnItem=${bestMaxScatter}; need spinsLeft bump or ≥4 scatters after opener)`,
        actual: { attempts, bestMaxScatter, entered: featureEnteredFromBody(lastBody) },
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
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
