/**
 * WD-003 — Wilds
 *
 * Manual Test Case ID: WD-003
 * Intent: Single Wild functionality — at least one multiplier/wild lands on a
 * stop or tumble board.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { huntWildBoard } from '../../support/wild-board.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'WD-003' as const;

test.describe.skip('WD — Wilds', () => {
  requireCapabilities('buyFeature', 'tumble', 'multiplierWild', 'reelValidation');

  test(`${MANUAL_TEST_ID} single wild functionality`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(900_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'WD' },
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

      const hunt = await huntWildBoard(
        sgapSession,
        sgapDriver,
        page,
        (view) => view.maxOnOneBoard >= 1,
      );

      verificationResults.push({
        kind: 'win',
        passed: hunt.view.maxOnOneBoard >= 1,
        message:
          hunt.view.maxOnOneBoard >= 1
            ? `Single wild/bomb on a board within ${hunt.attempts} buy(s) ` +
              `(max=${hunt.view.maxOnOneBoard}, ids=${hunt.view.multiplierIdsSeen.join(',')})`
            : `No wild/bomb after ${hunt.attempts} buy(s)`,
        actual: hunt.view,
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
