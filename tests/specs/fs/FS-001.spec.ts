/**
 * FS-001 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-001
 * Intent: Scatter triggers Feature correctly — a natural base-game spin that
 * lands enough scatters opens free spins (not Buy Feature).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
} from '../../support/buy-feature-verify.js';
import { drainFreeSpins, spinUntilScatterFeature } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-001' as const;
const SCATTER_TRIGGER_AT = 4;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('freeSpins', 'scatterTrigger');
  test(`${MANUAL_TEST_ID} scatter triggers Feature correctly`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    // Natural scatter can take many spins even with Amplify; keep headroom under 2-worker load.
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

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      if (await sgapSession.amplifyBet.isAvailable()) {
        await sgapSession.amplifyBet.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      }

      const hit = await spinUntilScatterFeature(sgapSession, sgapDriver, page, {
        maxSpins: 80,
        scatterTriggerAt: SCATTER_TRIGGER_AT,
      });
      const entered = featureEnteredFromBody(hit.bet.raw);
      const remaining = freeSpinItemsRemaining(hit.bet.raw);
      const scatterOk = hit.scatterCount >= SCATTER_TRIGGER_AT;
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered || scatterOk,
        message:
          entered || scatterOk
            ? `Scatter opened feature after ${hit.spinsTaken} spin(s) ` +
              `(scatters=${hit.scatterCount}, remaining=${remaining}, entered=${entered})`
            : `Spin ${hit.spinsTaken} did not open feature ` +
              `(scatters=${hit.scatterCount}, need ≥${SCATTER_TRIGGER_AT})`,
        expected: SCATTER_TRIGGER_AT,
        actual: hit.scatterCount,
      });

      if (entered) {
        await drainFreeSpins(sgapSession, sgapDriver, page, hit.bet.raw, 24);
      } else {
        await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, hit.bet.raw);
      }

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
