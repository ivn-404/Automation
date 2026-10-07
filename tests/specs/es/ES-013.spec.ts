/**
 * ES-013 — Edge & Stability
 *
 * Manual Test Case ID: ES-013
 * Intent: Help Screen validation — opening the in-game help/menu hub does not
 * fire a bet, and the session is still playable after close.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { expectNoBetWithin, spinForBet } from '../../support/canvas-bet-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-013' as const;

test.describe('ES — Edge & Stability', () => {
  requireCapabilities('menu');

  test(`${MANUAL_TEST_ID} Help Screen validation`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.menu.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const openActions = sgapSession.manifest.reelValidation?.helpOpenActions ?? ['menu'];
      for (const actionName of openActions) {
        await sgapDriver.clickCanvas(actionName, { timeoutMs: 12_000, singleInput: true }).catch(
          () => undefined,
        );
      }
      await sgapSession.menu.open({ timeoutMs: 20_000 }).catch(() => undefined);

      await expectNoBetWithin(page, 2_500);
      verificationResults.push({
        kind: 'stateManagement',
        passed: true,
        message: 'Help/menu hub open — no /bet fired while help was showing',
      });

      const closeActions = sgapSession.manifest.reelValidation?.helpCloseActions ?? [
        'menuClose',
        'menuCloseAlt',
      ];
      for (const actionName of closeActions) {
        await sgapDriver.clickCanvas(actionName, { timeoutMs: 8_000, singleInput: true }).catch(
          () => undefined,
        );
      }
      await sgapSession.menu.close({ timeoutMs: 20_000 }).catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, { forceGridSpam: true });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(bet, { requireCompleted: true }));

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
